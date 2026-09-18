import { useCallback, useEffect, useRef } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
  memberGroupsAtom,
} from '../atoms/global';
import {
  getGroupNotificationSettings,
  NOTIFICATION_SETTINGS_UPDATED_EVENT,
  type GroupNotificationSettingsData,
} from '../utils/qChatNotificationSettings';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

const POLL_INTERVAL_MS = 30_000;

export function useNotificationSettingsCache() {
  const setCache = useSetAtom(notificationSettingsCacheAtom);
  const setTick = useSetAtom(muteExpiryTickAtom);
  const memberGroups = useAtomValue(memberGroupsAtom);
  const cacheRef = useRef<Record<string, GroupNotificationSettingsData>>({});
  const memberGroupIdsRef = useRef<Array<string | number>>([]);

  useEffect(() => {
    memberGroupIdsRef.current = (memberGroups || [])
      .map((g: any) => g?.groupId)
      .filter((id: any) => id !== undefined && id !== null);
  }, [memberGroups]);

  const refreshGroup = useCallback(
    async (groupId: string | number) => {
      const settings = await getGroupNotificationSettings(groupId);
      cacheRef.current = {
        ...cacheRef.current,
        [String(groupId)]: settings,
      };
      setCache({ ...cacheRef.current });
    },
    [setCache]
  );

  useEffect(() => {
    const handler = (event: any) => {
      const groupId = event?.detail?.groupId;
      const settings = event?.detail?.settings;
      if (groupId === undefined || groupId === null) return;
      if (settings && typeof settings === 'object') {
        cacheRef.current = {
          ...cacheRef.current,
          [String(groupId)]: settings,
        };
        setCache({ ...cacheRef.current });
      } else {
        void refreshGroup(groupId);
      }
    };
    subscribeToEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, handler);
    return () => {
      unsubscribeFromEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, handler);
    };
  }, [refreshGroup, setCache]);

  useEffect(() => {
    const ids = memberGroupIdsRef.current;
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      const entries: Record<string, GroupNotificationSettingsData> = {};
      for (const id of ids) {
        const settings = await getGroupNotificationSettings(id);
        if (cancelled) return;
        entries[String(id)] = settings;
      }
      if (cancelled) return;
      cacheRef.current = entries;
      setCache({ ...entries });
    })();
    return () => {
      cancelled = true;
    };
  }, [memberGroups, setCache]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTick((t) => t + 1);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [setTick]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTick((t) => t + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setTick]);
}
