import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import i18n, { supportedLanguages } from '../../i18n/i18n';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  extStateAtom,
  paymentNotificationsAtom,
  customWebsocketSubscriptionsAtom,
  dmFriendsByAddressAtom,
  notificationSeenInAppKeysAtom,
  filterSeenInAppKeysByRules,
  reticulumChatEnabledAtom,
  unreadWelcomeEventIdsAtom,
  globalNotificationFormAtom,
} from '../../atoms/global';
import {
  fireOsNotificationPayment,
  handleNotificationClick,
} from '../../background/background';
import {
  getNotificationPermissionKey,
  getPermission,
} from '../../qortal/qortal-requests';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import {
  QCHAT_MENTION_NOTIFICATION_APP_NAME,
  QCHAT_MENTION_NOTIFICATION_EVENT,
} from '../../utils/qChatMentionNotifications';
import {
  getEffectiveNotificationSettings,
  getGroupNotificationSettings,
  getNotificationDeliveryMethod,
  isScopeMuted,
  buildChannelSectionMap,
  shouldFirePushNotification,
  shouldSuppressForMutedChannel,
  getWelcomeUnreadCount,
} from '../../utils/qChatNotificationSettings';
import {
  isHubBeingViewed,
  shouldNotifyForReticulumDm,
} from '../../utils/reticulumDmNotifications';
import {
  getReticulumNotificationChannelLabel,
  getChannelVisibilitySymbol,
} from '../../utils/reticulumNotificationChannel';
import { MAX_NOTIFICATION_PREVIEW_CHARS } from '../../constants/notificationConstants';
import qortPng from '../../assets/qort.png';

const shouldSuppressForCurrentView = (
  viewRef: React.MutableRefObject<{
    groupId: number;
    channelId: string;
    isAtBottom: boolean;
  }>,
  groupId: number,
  channelId: string
): boolean => {
  const ctx = viewRef.current;
  if (ctx.groupId < 0 || !ctx.isAtBottom) return false;
  return ctx.groupId === groupId && ctx.channelId === channelId;
};

const isQChatMentionNotification = (notification: any) =>
  notification?.appName === QCHAT_MENTION_NOTIFICATION_APP_NAME &&
  notification?.data?.qChatMention === true;

const isReticulumCalendarNotification = (notification: any) =>
  notification?.data?.reticulumCalendarReminder === true;

const NOTIFICATION_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const QCHAT_MENTION_OS_NOTIFICATION_MAX_TRACKED = 500;
const RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED = 500;

const getNotificationCreatorTimestamp = (notification: {
  data?: { created?: number; timestamp?: number };
  timestamp?: number;
}) =>
  notification?.data?.created ??
  notification?.data?.timestamp ??
  notification?.timestamp;

const trimNotificationsToLast3Days = <
  T extends {
    data?: { created?: number; timestamp?: number };
    timestamp?: number;
  },
>(
  notifications: T[]
): T[] => {
  const cutoff = Date.now() - NOTIFICATION_AGE_MS;
  return notifications.filter((notification) => {
    const timestamp = getNotificationCreatorTimestamp(notification);
    return timestamp == null || timestamp >= cutoff;
  });
};

/** Message object with "You got a new qmail" in all supported languages (for Q-Mail subscription). */
function getNewQmailMessage(): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = i18n.t('core:message.generic.new_qmail', { lng });
  }
  return message;
}

function getCalendarReminderMessage(title: string): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = `${i18n.t('core:calendar.reminder', { lng })}: ${title}`;
  }
  return message;
}

const formatChannelLine = (name: string): string => `${name}\n`;

const truncatePreview = (text: string, maxLen: number): string => {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
};

/** Picks message in current language, else en, else first available; not reactive. */
function getNotificationMessage(
  messageObj: Record<string, string> | undefined
): string {
  const fallback = 'New notification';
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (i18n.language || 'en').split('-')[0];
  const current = messageObj[lang];
  if (typeof current === 'string' && current.trim()) return current.trim();
  const en = messageObj.en;
  if (typeof en === 'string' && en.trim()) return en.trim();
  const first = Object.values(messageObj).find(
    (v) => typeof v === 'string' && (v as string).trim()
  );
  return typeof first === 'string' ? (first as string).trim() : fallback;
}

export const WebSocketNotifications = ({ myAddress, userName }) => {
  const extState = useAtomValue(extStateAtom);
  const extStateRef = useRef(extState);
  extStateRef.current = extState;
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const dmFriendsByAddressRef = useRef(dmFriendsByAddress);
  dmFriendsByAddressRef.current = dmFriendsByAddress;
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const setPaymentNotifications = useSetAtom(paymentNotificationsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const seenInAppKeys = useAtomValue(notificationSeenInAppKeysAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const welcomeUnreadMap = useAtomValue(unreadWelcomeEventIdsAtom);
  const welcomeUnreadMapRef = useRef(welcomeUnreadMap);
  welcomeUnreadMapRef.current = welcomeUnreadMap;
  const globalNotifForm = useAtomValue(globalNotificationFormAtom);
  const globalNotifFormRef = useRef(globalNotifForm);
  globalNotifFormRef.current = globalNotifForm;

  const [socketOpen, setSocketOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const historyRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const namesAbortControllerRef = useRef<AbortController | null>(null);
  const listOfMyNamesRef = useRef<string[]>([]);
  const initWebsocketRef = useRef<(() => Promise<void>) | null>(null);
  const qChatMentionOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const qChatReplyOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const qChatMessageOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const qChatReactionOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const reticulumDmOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const currentViewContextRef = useRef<{
    groupId: number;
    channelId: string;
    isAtBottom: boolean;
  }>({ groupId: -1, channelId: '', isAtBottom: false });

  useEffect(() => {
    const onScrollState = (e: CustomEvent) => {
      currentViewContextRef.current = {
        ...currentViewContextRef.current,
        isAtBottom: e.detail?.isAtBottom === true,
      };
    };
    const onOpenGroup = (e: CustomEvent) => {
      const gid = Number(e.detail?.from);
      if (Number.isFinite(gid)) {
        currentViewContextRef.current = {
          groupId: gid,
          channelId: String(e.detail?.channelId || ''),
          isAtBottom: currentViewContextRef.current.isAtBottom,
        };
      }
    };
    const onDeleteNotification = (e: CustomEvent) => {
      const evId = e.detail?.eventId;
      if (evId) {
        window.reticulumChat?.dismissNotification?.(String(evId));
      }
    };
    subscribeToEvent('chat-scroll-state', onScrollState);
    subscribeToEvent('openGroupMessage', onOpenGroup);
    subscribeToEvent('q-chat-delete-notification', onDeleteNotification);
    return () => {
      unsubscribeFromEvent('chat-scroll-state', onScrollState);
      unsubscribeFromEvent('openGroupMessage', onOpenGroup);
      unsubscribeFromEvent('q-chat-delete-notification', onDeleteNotification);
    };
  }, []);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const listeningSince = Date.now();
    reticulumDmOsNotifiedEventIdsRef.current.clear();
    const off = window.reticulumChat?.onDirectEvent?.(({ event }) => {
      if (!event || typeof event !== 'object') return;
      const directEvent = event as {
        eventId?: string;
        eventType?: string;
        senderAddress?: string;
        recipientAddress?: string;
        authorPrimaryName?: string;
        payload?: string;
        timestamp?: number;
        readByOwner?: boolean;
      };
      const eventId = String(directEvent.eventId || '');
      if (!eventId) return;

      // Handle DM deletion — dismiss OS notification and skip notification processing
      if (directEvent.eventType === 'delete') {
        if (directEvent.senderAddress) {
          window.reticulumChat?.dismissNotifications?.(
            NaN,
            directEvent.senderAddress
          );
        }
        return;
      }

      if (
        reticulumDmOsNotifiedEventIdsRef.current.has(eventId) ||
        !shouldNotifyForReticulumDm({
          event: directEvent,
          friendsByAddress: dmFriendsByAddressRef.current,
          listeningSince,
          myAddress,
          hubIsBeingViewed: isHubBeingViewed(),
        })
      ) {
        return;
      }

      reticulumDmOsNotifiedEventIdsRef.current.add(eventId);
      if (
        reticulumDmOsNotifiedEventIdsRef.current.size >
        RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED
      ) {
        const oldestEventId = reticulumDmOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId) {
          reticulumDmOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      const friend = dmFriendsByAddressRef.current[directEvent.senderAddress!];
      const senderName = friend?.name?.trim() || 'a friend';
      let dmMessageText = '';
      try {
        const payloadObj = JSON.parse(String(directEvent.payload || '{}'));
        if (payloadObj && typeof payloadObj === 'object') {
          dmMessageText = String(payloadObj.messageText || '').trim();
        }
      } catch {
        dmMessageText = String(directEvent.payload || '').trim();
      }
      dmMessageText = dmMessageText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const dmPreviewText = truncatePreview(
        dmMessageText,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      getNotificationDeliveryMethod().then((dmDeliveryMethod) => {
        void fireOsNotificationPayment(
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_DM_MESSAGE',
          },
          `${senderName} sent you a DM`,
          dmPreviewText,
          qortPng,
          undefined,
          {
            from: directEvent.senderAddress,
            name: friend?.name,
            messageText: dmMessageText,
            senderName,
            reticulumDirectMessage: true,
          },
          dmDeliveryMethod,
          directEvent.senderAddress
            ? { groupId: 0, channelId: directEvent.senderAddress }
            : undefined
        );
      });
    });

    const addMissedCallNotification = (record: any) => {
      if (
        record?.ownerAddress !== myAddress ||
        record?.direction !== 'incoming' ||
        record?.outcome !== 'missed' ||
        record?.readAt > 0
      )
        return;
      const callId = String(record.callId || '');
      const peerAddress = String(record.peerAddress || '');
      if (!callId || !peerAddress) return;
      const friend = dmFriendsByAddressRef.current[peerAddress];
      const senderName = friend?.name?.trim() || peerAddress;
      setPaymentNotifications((previous) => [
        ...previous.filter((item) => item?.data?.reticulumDmCallId !== callId),
        {
          appName: 'Q-Chat',
          appService: 'INTERNAL',
          event: 'RETICULUM_DM_MISSED_CALL',
          notificationId: `reticulum-dm-call-${callId}`,
          image: LogoSelected,
          message: { en: `Missed voice call from ${senderName}` },
          timestamp: Number(record.endedAt || Date.now()),
          data: {
            created: Number(record.endedAt || Date.now()),
            from: peerAddress,
            name: friend?.name,
            reticulumDmMissedCall: true,
            reticulumDmCallId: callId,
          },
        },
      ]);
    };
    void window.reticulumChat
      ?.getDirectCallHistory(myAddress, undefined, 50, true)
      .then((records) => records.forEach(addMissedCallNotification))
      .catch(() => undefined);
    const offCalls = window.reticulumChat?.onDirectCallHistory?.(
      ({ record }: any) => {
        if (record?.ownerAddress !== myAddress) return;
        if (record?.outcome === 'missed') {
          addMissedCallNotification(record);
          return;
        }
        const callId = String(record?.callId || '');
        if (!callId) return;
        setPaymentNotifications((previous) =>
          previous.filter((item) => item?.data?.reticulumDmCallId !== callId)
        );
      }
    );
    const offCallSummary = window.reticulumChat?.onDirectSummaryChanged?.(
      ({ peerAddress }: any) => {
        const peer = String(peerAddress || '');
        if (!peer) return;
        void window.reticulumChat
          ?.getDirectCallHistory(myAddress, peer, 1, true)
          .then((records) => {
            if (records.length > 0) return;
            setPaymentNotifications((previous) =>
              previous.filter(
                (item) =>
                  !(
                    item?.data?.reticulumDmMissedCall === true &&
                    item?.data?.from === peer
                  )
              )
            );
          })
          .catch(() => undefined);
      }
    );

    return () => {
      off?.();
      offCalls?.();
      offCallSummary?.();
    };
  }, [myAddress, reticulumChatEnabled, setPaymentNotifications]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const off = window.reticulumChat?.onCalendarReminderDue?.((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const reminder = payload as {
        ownerAddress?: string;
        groupId?: number;
        eventId?: string;
        occurrence?: ReticulumCalendarOccurrence;
      };
      if (reminder.ownerAddress !== myAddress || !reminder.occurrence) return;
      const occurrence = reminder.occurrence;
      const notificationId = `reticulum-calendar-${occurrence.occurrenceId}`;
      setPaymentNotifications((previous) =>
        trimNotificationsToLast3Days([
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_CALENDAR_REMINDER',
            notificationId,
            image: LogoSelected,
            message: getCalendarReminderMessage(occurrence.title),
            timestamp: Date.now(),
            data: {
              created: Date.now(),
              eventId: reminder.eventId,
              groupId: reminder.groupId,
              occurrenceStart: occurrence.occurrenceStart,
              timezone: occurrence.timezone,
              identifier: notificationId,
              reticulumCalendarReminder: true,
            },
          },
          ...previous.filter(
            (item) =>
              !(
                isReticulumCalendarNotification(item) &&
                item?.notificationId === notificationId
              )
          ),
        ])
      );
      if (!isHubBeingViewed()) {
        getNotificationDeliveryMethod().then((calDeliveryMethod) => {
          void fireOsNotificationPayment(
            {
              appName: 'Q-Chat',
              appService: 'INTERNAL',
              event: 'RETICULUM_CALENDAR_REMINDER',
            },
            occurrence.title,
            occurrence.allDay
              ? i18n.t('core:calendar.allDay')
              : `${i18n.t('core:calendar.starts')} ${new Date(
                  occurrence.occurrenceStart
                ).toLocaleString()}`,
            qortPng,
            undefined,
            {
              from: reminder.groupId,
              eventId: reminder.eventId,
              occurrenceStart: occurrence.occurrenceStart,
              timezone: occurrence.timezone,
              openCalendar: true,
            },
            calDeliveryMethod
          );
        });
      }
    });
    return () => off?.();
  }, [myAddress, reticulumChatEnabled, setPaymentNotifications]);

  const forceCloseWebSocket = () => {
    connectionIdRef.current += 1;
    setSocketOpen(false);
    namesAbortControllerRef.current?.abort();
    namesAbortControllerRef.current = null;
    clearTimeout(historyRequestTimeoutRef.current);
    clearTimeout(reconnectTimeoutRef.current);
    clearTimeout(timeoutIdRef.current);
    clearTimeout(pingTimeoutRef.current);
    historyRequestTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;
    timeoutIdRef.current = null;
    pingTimeoutRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.close(1000, 'forced');
    }
  };

  const logoutEventFunc = () => {
    forceCloseWebSocket();
  };

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, []);

  useEffect(() => {
    const off = window.reticulumChat?.onNotificationClicked?.(
      (notificationId) => {
        handleNotificationClick(notificationId);
      }
    );
    return () => off?.();
  }, []);

  useEffect(() => {
    const handler = () => {
      forceCloseWebSocket();
      setSocketOpen(false);
      if (initWebsocketRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          void initWebsocketRef.current?.();
        }, 0);
      }
    };
    subscribeToEvent('notifications-websocket-reconnect', handler);
    return () =>
      unsubscribeFromEvent('notifications-websocket-reconnect', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => setCustomSubscriptions(e.detail ?? []);
    subscribeToEvent('custom-ws-subscriptions-updated', handler);
    return () =>
      unsubscribeFromEvent('custom-ws-subscriptions-updated', handler);
  }, [setCustomSubscriptions]);

  useEffect(() => {
    const handleQChatMention = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        mentionCount?: number;
        syncUnreadCount?: boolean;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      const isUnreadCountSync = detail?.syncUnreadCount === true;
      if ((!eventId && !isUnreadCountSync) || !Number.isFinite(groupId)) {
        return;
      }

      const channelId = String(detail?.channelId || 'general');
      const isEveryoneOrHere = detail?.isEveryoneOrHere === true;
      const groupSettings = await getGroupNotificationSettings(groupId).catch(
        () => null
      );
      const sectionMap = groupSettings
        ? buildChannelSectionMap(groupSettings)
        : new Map();
      const sectionId = sectionMap.get(channelId);
      const channelMuted = groupSettings
        ? isScopeMuted(groupSettings, sectionId, channelId)
        : false;
      const effectiveSettings = await getEffectiveNotificationSettings(
        groupId,
        sectionId,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);

      const shouldPush =
        effectiveSettings != null &&
        shouldFirePushNotification(
          effectiveSettings,
          true,
          isEveryoneOrHere,
          false
        ) &&
        !shouldSuppressForMutedChannel(
          channelMuted,
          effectiveSettings.pushLevel,
          true
        );

      const timestamp = Number(detail?.timestamp || Date.now());
      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      if (!isUnreadCountSync || Number(detail?.mentionCount || 0) > 0) {
        try {
          const channels = await window.reticulumChat?.getChannels?.(
            groupId,
            true
          );
          channelName = getReticulumNotificationChannelLabel(
            channelId,
            channels
          );
          channelVisibilitySymbol = getChannelVisibilitySymbol(channelId, channels);
        } catch {
          // The stable ID remains a useful fallback while metadata is syncing.
        }
      }
      setPaymentNotifications((previous) => {
        const trimmed = trimNotificationsToLast3Days(previous);
        const existing = trimmed.find(
          (notification) =>
            isQChatMentionNotification(notification) &&
            Number(notification?.data?.groupId) === groupId
        );
        if (isUnreadCountSync) {
          let mentionCount = Math.max(0, Number(detail?.mentionCount) || 0);
          if (
            mentionCount > 0 &&
            (groupSettings?.notifyOnWelcomePosts ??
              globalNotifFormRef.current.notifyOnWelcomePosts) === false
          ) {
            const welcomeCount = getWelcomeUnreadCount(
              welcomeUnreadMapRef.current,
              groupId
            );
            mentionCount = Math.max(0, mentionCount - welcomeCount);
          }
          if (mentionCount === 0) {
            return trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            );
          }
          const syncedNotification = {
            appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
            appService: 'INTERNAL',
            data: {
              channelId,
              channelName,
              created: timestamp,
              eventId: existing?.data?.eventId || '',
              eventIds: existing?.data?.eventIds || [],
              groupId,
              groupName,
              identifier: `q-chat-mention-${groupId}`,
              mentionCount,
              qChatMention: true,
            },
            event: QCHAT_MENTION_NOTIFICATION_EVENT,
            image: '',
            message: {
              en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
            },
            notificationId: `q-chat-mention-${groupId}`,
          };
          return [
            syncedNotification,
            ...trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            ),
          ];
        }
        const eventIds = Array.isArray(existing?.data?.eventIds)
          ? existing.data.eventIds
          : existing?.data?.eventId
            ? [existing.data.eventId]
            : [];
        if (eventIds.includes(eventId)) return trimmed;

        const nextEventIds = [...eventIds, eventId].slice(-100);
        const mentionCount = Math.max(
          nextEventIds.length,
          Number(existing?.data?.mentionCount) || 0
        );
        const nextNotification = {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          data: {
            channelId,
            channelName,
            created: timestamp,
            eventId,
            eventIds: nextEventIds,
            groupId,
            groupName,
            identifier: `q-chat-mention-${groupId}`,
            mentionCount,
            qChatMention: true,
          },
          event: QCHAT_MENTION_NOTIFICATION_EVENT,
          image: '',
          message: {
            en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
          },
          notificationId: `q-chat-mention-${groupId}`,
        };
        return [
          nextNotification,
          ...trimmed.filter(
            (notification) =>
              !(
                isQChatMentionNotification(notification) &&
                Number(notification?.data?.groupId) === groupId
              )
          ),
        ];
      });

      // Unread-count synchronization rebuilds the Hub notification state and
      // must not replay old mentions as OS notifications.
      if (
        shouldPush &&
        !isUnreadCountSync &&
        !qChatMentionOsNotifiedEventIdsRef.current.has(eventId)
      ) {
        qChatMentionOsNotifiedEventIdsRef.current.add(eventId);
        if (
          qChatMentionOsNotifiedEventIdsRef.current.size >
          QCHAT_MENTION_OS_NOTIFICATION_MAX_TRACKED
        ) {
          const oldestEventId = qChatMentionOsNotifiedEventIdsRef.current
            .values()
            .next().value;
          if (oldestEventId) {
            qChatMentionOsNotifiedEventIdsRef.current.delete(oldestEventId);
          }
        }
        const mentionSender = detail.senderName || 'Someone';
        const mentionText = detail.messageText || '';
        if (
          shouldSuppressForCurrentView(
            currentViewContextRef,
            groupId,
            channelId
          )
        )
          return;
        const previewText = truncatePreview(
          `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${mentionText}`,
          MAX_NOTIFICATION_PREVIEW_CHARS
        );
        const mentionDeliveryMethod = await getNotificationDeliveryMethod();
        void fireOsNotificationPayment(
          {
            appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
            appService: 'INTERNAL',
            event: QCHAT_MENTION_NOTIFICATION_EVENT,
          },
          `${mentionSender} mentioned you in ${groupName}`,
          previewText,
          qortPng,
          undefined,
          {
            channelId,
            eventId,
            from: groupId,
            messageText: mentionText,
            senderName: mentionSender,
            qChatMention: true,
          },
          mentionDeliveryMethod,
          { groupId, channelId },
          eventId
        );
      }
    };

    const handleQChatReplyNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;

      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      const channelId = String(detail?.channelId || 'general');

      const replyGroupSettings = await getGroupNotificationSettings(
        groupId
      ).catch(() => null);
      const replySectionMap = replyGroupSettings
        ? buildChannelSectionMap(replyGroupSettings)
        : new Map();
      const replySectionId = replySectionMap.get(channelId);
      const replyMuted = replyGroupSettings
        ? isScopeMuted(replyGroupSettings, replySectionId, channelId)
        : false;
      if (replyMuted) return;

      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(channelId, channels);
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }

      if (qChatReplyOsNotifiedEventIdsRef.current.has(eventId)) return;
      qChatReplyOsNotifiedEventIdsRef.current.add(eventId);
      if (qChatReplyOsNotifiedEventIdsRef.current.size > 500) {
        const oldestEventId = qChatReplyOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId !== undefined) {
          qChatReplyOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;
      const replySender = detail.senderName || 'Someone';
      const replyText = detail.messageText || '';
      const previewText = truncatePreview(
        `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${replyText}`,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      const replyDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_REPLY',
        },
        `${replySender} replied to you in ${groupName}`,
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          messageText: replyText,
          senderName: replySender,
          qChatReply: true,
        },
        replyDeliveryMethod,
        { groupId, channelId },
        eventId
      );
    };

    const handleQChatReactionNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        senderName?: string;
        reactionEmoji?: string;
        messageText?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;

      if (qChatReactionOsNotifiedEventIdsRef.current.has(eventId)) return;
      qChatReactionOsNotifiedEventIdsRef.current.add(eventId);
      if (qChatReactionOsNotifiedEventIdsRef.current.size > 500) {
        const oldestEventId = qChatReactionOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId !== undefined) {
          qChatReactionOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      const reactionSender = detail.senderName || 'Someone';
      const reactionEmoji = detail.reactionEmoji || '';
      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      const channelId = String(detail?.channelId || 'general');

      const rxnGroupSettings = await getGroupNotificationSettings(
        groupId
      ).catch(() => null);
      const rxnSectionMap = rxnGroupSettings
        ? buildChannelSectionMap(rxnGroupSettings)
        : new Map();
      const rxnSectionId = rxnSectionMap.get(channelId);
      const rxnMuted = rxnGroupSettings
        ? isScopeMuted(rxnGroupSettings, rxnSectionId, channelId)
        : false;
      if (rxnMuted) return;

      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(channelId, channels);
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }
      const parentMessageText = detail.messageText || '';
      const previewText = parentMessageText
        ? truncatePreview(
            `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${parentMessageText}`,
            MAX_NOTIFICATION_PREVIEW_CHARS
          )
        : '';
      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;
      const reactionDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_REACTION',
        },
        `${reactionSender} reacted to your post with ${reactionEmoji} in ${groupName}`,
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          senderName: reactionSender,
          messageText: parentMessageText,
          qChatReaction: true,
        },
        reactionDeliveryMethod,
        { groupId, channelId },
        eventId
      );
    };

    const handleQChatMessageNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;

      const channelId = String(detail?.channelId || 'general');
      const groupSettings = await getGroupNotificationSettings(groupId).catch(
        () => null
      );
      const sectionMap = groupSettings
        ? buildChannelSectionMap(groupSettings)
        : new Map();
      const sectionId = sectionMap.get(channelId);
      const channelMuted = groupSettings
        ? isScopeMuted(groupSettings, sectionId, channelId)
        : false;
      const effectiveSettings = await getEffectiveNotificationSettings(
        groupId,
        sectionId,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);

      const shouldPush =
        effectiveSettings != null &&
        shouldFirePushNotification(effectiveSettings, false, false, false) &&
        !shouldSuppressForMutedChannel(
          channelMuted,
          effectiveSettings.pushLevel,
          false
        );

      if (!shouldPush) return;

      if (qChatMessageOsNotifiedEventIdsRef.current.has(eventId)) return;
      qChatMessageOsNotifiedEventIdsRef.current.add(eventId);
      if (
        qChatMessageOsNotifiedEventIdsRef.current.size >
        QCHAT_MENTION_OS_NOTIFICATION_MAX_TRACKED
      ) {
        const oldestEventId = qChatMessageOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId) {
          qChatMessageOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(channelId, channels);
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }

      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;
      const msgSender = detail.senderName || 'Someone';
      const msgText = detail.messageText || '';
      const previewText = truncatePreview(
        `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${msgText}`,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      const messageDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_MESSAGE',
        },
        `${msgSender} posted in ${groupName}`,
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          messageText: msgText,
          senderName: msgSender,
          qChatMessage: true,
        },
        messageDeliveryMethod,
        { groupId, channelId },
        eventId
      );
    };

    subscribeToEvent(
      'q-chat-mention-notification',
      handleQChatMention as EventListener
    );
    subscribeToEvent(
      'q-chat-reply-notification',
      handleQChatReplyNotification as EventListener
    );
    subscribeToEvent(
      'q-chat-reaction-notification',
      handleQChatReactionNotification as EventListener
    );
    subscribeToEvent(
      'q-chat-message-notification',
      handleQChatMessageNotification as EventListener
    );
    return () => {
      unsubscribeFromEvent(
        'q-chat-mention-notification',
        handleQChatMention as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-reply-notification',
        handleQChatReplyNotification as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-reaction-notification',
        handleQChatReactionNotification as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-message-notification',
        handleQChatMessageNotification as EventListener
      );
    };
  }, [setPaymentNotifications]);

  useEffect(() => {
    const current = Array.isArray(seenInAppKeys) ? seenInAppKeys : [];
    const filtered = filterSeenInAppKeysByRules(
      current,
      customSubscriptions ?? []
    );
    if (filtered.length !== current.length) {
      setSeenInAppKeys(filtered);
    }
  }, [customSubscriptions, seenInAppKeys, setSeenInAppKeys]);

  useEffect(() => {
    const handler = (e) => {
      const notificationIds = e.detail;
      if (
        !notificationIds?.length ||
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      )
        return;
      socketRef.current.send(
        JSON.stringify({ action: 'unsubscribe', notificationIds })
      );
    };
    subscribeToEvent('custom-ws-unsubscribe', handler);
    return () => unsubscribeFromEvent('custom-ws-unsubscribe', handler);
  }, []);

  useEffect(() => {
    if (
      !socketOpen ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    )
      return;
    if (!customSubscriptions?.length) return;
    socketRef.current.send(
      JSON.stringify({
        action: 'subscribe',
        subscriptions: customSubscriptions,
      })
    );
  }, [socketOpen, customSubscriptions]);

  useEffect(() => {
    if (!myAddress || extState === 'not-authenticated' || !userName) return;

    /** Remove RESOURCE_PUBLISHED rules whose appName does not have qAPPNotification permission. */
    const filterSubscriptionsByNotificationPermission = async (
      subscriptions
    ) => {
      if (!Array.isArray(subscriptions)) return [];
      const result = [];
      for (const sub of subscriptions) {
        if (sub?.event !== 'RESOURCE_PUBLISHED') {
          result.push(sub);
          continue;
        }
        const appName = sub?.appName;
        if (!appName) continue;
        const allowed = await getPermission(
          getNotificationPermissionKey(appName)
        );
        if (allowed === true) result.push(sub);
      }
      return result;
    };

    let effectActive = true;

    const pingHeads = (
      socket: WebSocket,
      isCurrentConnection: (socket?: WebSocket | null) => boolean
    ) => {
      try {
        if (
          isCurrentConnection(socket) &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            timeoutIdRef.current = null;
            if (isCurrentConnection(socket)) {
              socket.close();
              clearTimeout(pingTimeoutRef.current);
              pingTimeoutRef.current = null;
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Error during ping (notifications):', error);
      }
    };

    const initWebsocketNotifications = async () => {
      forceCloseWebSocket();
      const connectionId = connectionIdRef.current;
      const isCurrentConnection = (socket?: WebSocket | null) => {
        if (!effectActive || connectionIdRef.current !== connectionId) {
          return false;
        }
        if (socket && socketRef.current !== socket) return false;
        return true;
      };
      const currentAddress = myAddress;
      if (extStateRef.current === 'not-authenticated') return;
      if (currentAddress !== myAddressRef.current) return;

      const namesAbortController = new AbortController();
      namesAbortControllerRef.current = namesAbortController;
      try {
        const getNamesUrl = `${getBaseApiReact()}/names/address/${currentAddress}?limit=0`;
        const namesResponse = await fetch(getNamesUrl, {
          signal: namesAbortController.signal,
        });
        const namesData = await namesResponse.json();
        if (!isCurrentConnection()) return;
        listOfMyNamesRef.current = namesData.map(
          (n: { name: string }) => n.name
        );
        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        const socketLink = `${getBaseApiReactSocket()}/websockets/notifications`;
        const socket = new WebSocket(socketLink);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!isCurrentConnection(socket)) {
            socket.close(1000, 'superseded');
            return;
          }
          setSocketOpen(true);
          socket.send(
            JSON.stringify({
              action: 'subscribe',
              subscriptions: [
                {
                  event: 'PAYMENT_RECEIVED',
                  notificationId: 'payment-notification',

                  filters: {
                    recipient: currentAddress,
                  },
                },
                {
                  event: 'RESOURCE_PUBLISHED',
                  resourceFilter: {
                    service: 'MAIL_PRIVATE',
                    identifier: query, // same variable you're using in the fetch
                    excludeBlocked: true,
                    mode: 'ALL',
                  },
                  image: `/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true`,
                  link: 'qortal://app/Q-Mail',
                  notificationId: 'q-mail-notification',
                  appName: 'Q-Mail',
                  appService: 'APP',
                  message: getNewQmailMessage(),
                },
              ],
            })
          );
          historyRequestTimeoutRef.current = setTimeout(() => {
            historyRequestTimeoutRef.current = null;
            if (
              !isCurrentConnection(socket) ||
              socket.readyState !== WebSocket.OPEN
            )
              return;
            const after = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago (ms)
            socket.send(
              JSON.stringify({
                action: 'notification-history',
                paymentReceivedLimit: 5,
                after,
              })
            );
          }, 1000);
          pingTimeoutRef.current = setTimeout(
            () => pingHeads(socket, isCurrentConnection),
            50
          );
        };

        socket.onmessage = (e) => {
          if (!isCurrentConnection(socket)) return;
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              timeoutIdRef.current = null;
              pingTimeoutRef.current = setTimeout(
                () => pingHeads(socket, isCurrentConnection),
                20000
              );
            } else {
              const data = JSON.parse(e.data);

              if (data?.type === 'history' && data?.results) {
                const filtered = data.results.filter(
                  (n) =>
                    !(
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      listOfMyNamesRef.current.includes(n?.data?.name)
                    )
                );
                setPaymentNotifications((previous) => [
                  ...previous.filter(isQChatMentionNotification),
                  ...trimNotificationsToLast3Days(filtered),
                ]);
              }
              if (data?.event === 'PAYMENT_RECEIVED' && data?.data) {
                const tx = data;
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) => n.signature === tx.data?.signature
                  );
                  if (alreadyExists) return trimmed;
                  return [tx, ...trimmed];
                });
                fireOsNotificationPayment(
                  tx,
                  i18n.t('core:message.generic.new_payment_received'),
                  i18n.t('core:message.generic.new_payment_body', {
                    amount: tx?.data?.amount ?? 0,
                  }),
                  `${getBaseApiReact()}/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true`,
                  tx?.link
                );
              }
              if (data?.event === 'RESOURCE_PUBLISHED' && data?.data) {
                const tx = { ...data };
                if (listOfMyNamesRef.current.includes(tx?.data?.name)) return;
                if (tx.data && tx.data.created == null) {
                  tx.data = { ...tx.data, created: Date.now() };
                }
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) =>
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      n?.data?.identifier === tx.data?.identifier
                  );
                  if (alreadyExists) return trimmed;
                  return [tx, ...trimmed];
                });
                fireOsNotificationPayment(
                  tx,
                  i18n.t('core:message.generic.new_notification_from', {
                    appName: tx.appName ?? 'App',
                  }),
                  getNotificationMessage(tx.message),
                  `${getBaseApiReact()}${tx.image}`,
                  tx?.link
                );
              }
            }
          } catch (error) {
            console.error('Error parsing notifications message:', error);
          }
        };

        socket.onclose = (event) => {
          if (!isCurrentConnection(socket)) return;
          socketRef.current = null;
          setSocketOpen(false);
          clearTimeout(historyRequestTimeoutRef.current);
          historyRequestTimeoutRef.current = null;
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(
            `Notifications WebSocket closed: ${event.reason || 'unknown reason'}`
          );
          if (extStateRef.current === 'not-authenticated') return;
          if (event.reason !== 'forced' && event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isCurrentConnection()) {
                void initWebsocketNotifications();
              }
            }, 10000);
          }
        };

        socket.onerror = (error) => {
          if (!isCurrentConnection(socket)) return;
          console.error('Notifications WebSocket error:', error);
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          socket.close();
        };
      } catch (error) {
        if (namesAbortController.signal.aborted) return;
        console.error('Error initializing notifications WebSocket:', error);
      } finally {
        if (namesAbortControllerRef.current === namesAbortController) {
          namesAbortControllerRef.current = null;
        }
      }
    };

    initWebsocketRef.current = initWebsocketNotifications;

    (async () => {
      const filtered = await filterSubscriptionsByNotificationPermission(
        customSubscriptions ?? []
      );
      if (!effectActive) return;
      setCustomSubscriptions(filtered);
      void initWebsocketNotifications();
    })();

    return () => {
      effectActive = false;
      initWebsocketRef.current = null;
      forceCloseWebSocket();
    };
  }, [myAddress, extState, userName]);

  return null;
};
