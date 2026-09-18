import { executeEvent } from './events';

export const NOTIFICATION_SETTINGS_UPDATED_EVENT =
  'q-chat-notification-settings-updated';
export const QCHAT_REPLY_NOTIFICATION_EVENT = 'Q_CHAT_REPLY';

export type PushLevel = 'all' | 'mentions' | 'none';

export interface ScopeNotificationSettings {
  pushLevel?: PushLevel;
  suppressEveryoneHere?: boolean;
  notifyOnReplies?: boolean;
  mutedUntil?: number | null;
}

export interface ChannelNotificationSettings extends ScopeNotificationSettings {}

export interface SectionNotificationSettings extends ScopeNotificationSettings {
  channels?: Record<string, ChannelNotificationSettings>;
}

export interface GroupNotificationSettingsData extends ScopeNotificationSettings {
  sections?: Record<string, SectionNotificationSettings>;
  hideMutedChannels?: boolean;
  notifyOnWelcomePosts?: boolean;
}

export interface EffectiveNotificationSettings {
  pushLevel: PushLevel;
  suppressEveryoneHere: boolean;
  notifyOnReplies: boolean;
  notifyOnWelcomePosts: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: EffectiveNotificationSettings = {
  pushLevel: 'mentions',
  suppressEveryoneHere: false,
  notifyOnReplies: true,
  notifyOnWelcomePosts: true,
};

const SETTINGS_KEY_PREFIX = 'q-chat-notification-settings-';
const MIGRATION_FLAG_KEY = 'q-chat-notification-settings-migrated';
const OLD_MENTION_DISABLED_KEY = 'q-chat-mention-notifications-disabled';
const OLD_MUTED_GROUPS_KEY = 'mutedGroups';

function settingsKey(groupId: string | number): string {
  return `${SETTINGS_KEY_PREFIX}${groupId}`;
}

export async function getGroupNotificationSettings(
  groupId: string | number
): Promise<GroupNotificationSettingsData> {
  const data = await window
    .sendMessage('getUserSettings', {
      key: settingsKey(groupId),
    })
    .catch(() => null);
  if (!data || typeof data !== 'object') return {};
  return data as GroupNotificationSettingsData;
}

export async function setGroupNotificationSettings(
  groupId: string | number,
  settings: GroupNotificationSettingsData
): Promise<void> {
  const response = await window.sendMessage('addUserSettings', {
    keyValue: {
      key: settingsKey(groupId),
      value: settings,
    },
  });
  if (response?.error) {
    throw new Error(response.error);
  }
  executeEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, { groupId, settings });
}

export async function getEffectiveNotificationSettings(
  groupId: string | number,
  sectionId?: string,
  channelId?: string
): Promise<EffectiveNotificationSettings> {
  const groupSettings = await getGroupNotificationSettings(groupId);
  return resolveEffectiveSettings(groupSettings, sectionId, channelId);
}

export function resolveEffectiveSettings(
  groupSettings: GroupNotificationSettingsData,
  sectionId?: string,
  channelId?: string
): EffectiveNotificationSettings {
  const result: EffectiveNotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(groupSettings.pushLevel !== undefined
      ? { pushLevel: groupSettings.pushLevel }
      : {}),
    ...(groupSettings.suppressEveryoneHere !== undefined
      ? { suppressEveryoneHere: groupSettings.suppressEveryoneHere }
      : {}),
    ...(groupSettings.notifyOnReplies !== undefined
      ? { notifyOnReplies: groupSettings.notifyOnReplies }
      : {}),
    ...(groupSettings.notifyOnWelcomePosts !== undefined
      ? { notifyOnWelcomePosts: groupSettings.notifyOnWelcomePosts }
      : {}),
  };

  if (sectionId && groupSettings.sections?.[sectionId]) {
    const section = groupSettings.sections[sectionId];
    if (section.pushLevel !== undefined) result.pushLevel = section.pushLevel;
    if (section.suppressEveryoneHere !== undefined)
      result.suppressEveryoneHere = section.suppressEveryoneHere;
    if (section.notifyOnReplies !== undefined)
      result.notifyOnReplies = section.notifyOnReplies;

    if (channelId && section.channels?.[channelId]) {
      const channel = section.channels[channelId];
      if (channel.pushLevel !== undefined) result.pushLevel = channel.pushLevel;
      if (channel.suppressEveryoneHere !== undefined)
        result.suppressEveryoneHere = channel.suppressEveryoneHere;
      if (channel.notifyOnReplies !== undefined)
        result.notifyOnReplies = channel.notifyOnReplies;
    }
  }

  return result;
}

export interface ScopeDescriptor {
  groupId: string | number;
  sectionId?: string;
  channelId?: string;
}

export async function setScopeNotificationSettings(
  scope: ScopeDescriptor,
  settings: ScopeNotificationSettings & {
    notifyOnWelcomePosts?: boolean;
    hideMutedChannels?: boolean;
  }
): Promise<void> {
  const groupSettings = await getGroupNotificationSettings(scope.groupId);

  if (scope.sectionId == null && scope.channelId == null) {
    Object.assign(groupSettings, settings);
  } else if (scope.sectionId != null) {
    if (!groupSettings.sections) groupSettings.sections = {};
    if (!groupSettings.sections[scope.sectionId])
      groupSettings.sections[scope.sectionId] = {};

    if (scope.channelId == null) {
      Object.assign(groupSettings.sections[scope.sectionId], settings);
    } else {
      const section = groupSettings.sections[scope.sectionId];
      if (!section.channels) section.channels = {};
      if (!section.channels[scope.channelId])
        section.channels[scope.channelId] = {};
      Object.assign(section.channels[scope.channelId], settings);
    }
  } else if (scope.channelId != null) {
    if (!groupSettings.sections) groupSettings.sections = {};
    const defaultSectionKey = '';
    if (!groupSettings.sections[defaultSectionKey])
      groupSettings.sections[defaultSectionKey] = {};
    const section = groupSettings.sections[defaultSectionKey];
    if (!section.channels) section.channels = {};
    if (!section.channels[scope.channelId])
      section.channels[scope.channelId] = {};
    Object.assign(section.channels[scope.channelId], settings);
  }

  await setGroupNotificationSettings(scope.groupId, groupSettings);
}

export interface AllGroupsNotificationSettings {
  pushLevel?: PushLevel;
  suppressEveryoneHere?: boolean;
  notifyOnReplies?: boolean;
  notifyOnWelcomePosts?: boolean;
  hideMutedChannels?: boolean;
}

export async function applyNotificationSettingsToAllGroups(
  groupIds: Array<string | number>,
  settings: AllGroupsNotificationSettings
): Promise<void> {
  await Promise.all(
    groupIds.map((groupId) =>
      setScopeNotificationSettings({ groupId }, settings)
    )
  );
}

export function shouldFirePushNotification(
  effective: EffectiveNotificationSettings,
  isMention: boolean,
  isEveryoneOrHere: boolean,
  isReplyToUser: boolean
): boolean {
  if (effective.pushLevel === 'all') return true;

  if (
    effective.pushLevel === 'mentions' &&
    isMention &&
    !(effective.suppressEveryoneHere && isEveryoneOrHere)
  ) {
    return true;
  }

  if (effective.notifyOnReplies && isReplyToUser) return true;

  return false;
}

export async function migrateNotificationSettings(
  memberGroupIds: Array<string | number>
): Promise<void> {
  const alreadyMigrated = await window
    .sendMessage('getUserSettings', {
      key: MIGRATION_FLAG_KEY,
    })
    .catch(() => false);

  if (alreadyMigrated === true) return;

  const oldMentionDisabled = await window
    .sendMessage('getUserSettings', {
      key: OLD_MENTION_DISABLED_KEY,
    })
    .catch(() => false);

  const wasMentionsDisabled = oldMentionDisabled === true;

  const mutedGroups = await window
    .sendMessage('getUserSettings', {
      key: OLD_MUTED_GROUPS_KEY,
    })
    .catch(() => []);

  const mutedGroupIds = Array.isArray(mutedGroups) ? mutedGroups : [];

  for (const groupId of memberGroupIds) {
    const existing = await getGroupNotificationSettings(groupId);
    if (
      existing.pushLevel !== undefined ||
      existing.suppressEveryoneHere !== undefined ||
      existing.notifyOnReplies !== undefined
    ) {
      continue;
    }

    const isMuted = mutedGroupIds.some((id) => String(id) === String(groupId));

    if (isMuted || wasMentionsDisabled) {
      await setGroupNotificationSettings(groupId, {
        ...existing,
        pushLevel: 'none',
      });
    }
  }

  await window.sendMessage('addUserSettings', {
    keyValue: {
      key: MIGRATION_FLAG_KEY,
      value: true,
    },
  });
}

export async function setScopeMuted(
  scope: ScopeDescriptor,
  mutedUntil: number | null
): Promise<void> {
  await setScopeNotificationSettings(scope, { mutedUntil });
}

export async function unmuteScope(scope: ScopeDescriptor): Promise<void> {
  await setScopeNotificationSettings(scope, { mutedUntil: 0 });
}

/**
 * Sentinel value meaning "explicitly unmuted" — overrides parent mute.
 * `isMutedUntilActive(0)` returns false, but isScopeMuted treats 0 as
 * a stop signal so it won't walk up to the parent scope.
 */
export const EXPLICITLY_UNMUTED = 0;

export function isScopeMuted(
  groupSettings: GroupNotificationSettingsData,
  sectionId?: string,
  channelId?: string
): boolean {
  // Check most-specific scope first (channel → section → group).
  // A `mutedUntil` of 0 means "explicitly unmuted" and overrides parent mute.

  // Channel level
  if (channelId != null) {
    const effectiveSectionId = sectionId ?? '';
    const channel =
      groupSettings.sections?.[effectiveSectionId]?.channels?.[channelId];
    if (channel?.mutedUntil !== undefined) {
      return isMutedUntilActive(channel.mutedUntil);
    }
  }

  // Section level
  if (sectionId != null) {
    const section = groupSettings.sections?.[sectionId];
    if (section?.mutedUntil !== undefined) {
      return isMutedUntilActive(section.mutedUntil);
    }
  }

  // Group level
  if (groupSettings.mutedUntil !== undefined) {
    return isMutedUntilActive(groupSettings.mutedUntil);
  }

  return false;
}

export function getScopeMutedUntil(
  groupSettings: GroupNotificationSettingsData,
  sectionId?: string,
  channelId?: string
): number | null | undefined {
  if (channelId != null) {
    const effectiveSectionId = sectionId ?? '';
    const channel =
      groupSettings.sections?.[effectiveSectionId]?.channels?.[channelId];
    if (channel?.mutedUntil !== undefined) {
      return channel.mutedUntil;
    }
  }
  if (sectionId != null) {
    const section = groupSettings.sections?.[sectionId];
    if (section?.mutedUntil !== undefined) {
      return section.mutedUntil;
    }
  }
  return groupSettings.mutedUntil;
}

function isMutedUntilActive(mutedUntil: number | null | undefined): boolean {
  if (mutedUntil === undefined) return false;
  if (mutedUntil === null) return true;
  return mutedUntil > Date.now();
}

/**
 * Builds a map from channelId to the sectionId it was stored under in
 * group notification settings. This lets `groupHasUnreadConsideringMute`
 * call `isScopeMuted` with the correct sectionId for each channel,
 * even though per-channel summary entries don't carry section/category info.
 */
function buildChannelSectionMap(
  groupSettings: GroupNotificationSettingsData | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (!groupSettings?.sections) return map;
  for (const [sectionId, section] of Object.entries(groupSettings.sections)) {
    if (!section?.channels) continue;
    for (const channelId of Object.keys(section.channels)) {
      map.set(channelId, sectionId);
    }
  }
  return map;
}

/**
 * Determines whether a group should show its red unread dot, considering
 * channel-level mute state.
 *
 * If the group is NOT muted at the group level, iterates per-channel
 * summaries and excludes muted channels' unread from the total.
 * Falls back to the group-level aggregate when per-channel data is absent.
 * If the group IS muted, checks whether any explicitly unmuted channel
 * (mutedUntil === 0) has unread messages in the per-channel summaries.
 */
export function groupHasUnreadConsideringMute(
  groupSettings: GroupNotificationSettingsData | undefined,
  summary: any,
  welcomeUnreadCount?: number
): boolean {
  if (!summary) {
    return false;
  }

  const notifyOnWelcomePosts = groupSettings?.notifyOnWelcomePosts !== false;
  const welcomeCount =
    !notifyOnWelcomePosts && welcomeUnreadCount ? welcomeUnreadCount : 0;

  const groupMuted = groupSettings ? isScopeMuted(groupSettings) : false;

  if (!groupMuted) {
    const channels = Array.isArray(summary?.channels) ? summary.channels : [];

    // No per-channel data — fall back to group-level aggregate counts.
    if (channels.length === 0) {
      if (welcomeCount > 0) {
        const mentionCount = Number(summary?.mentionCount ?? 0);
        const unreadCount = Number(summary?.unreadCount ?? 0);
        const hasUnreadMention =
          summary?.hasUnreadMention === true && mentionCount - welcomeCount > 0;
        return (
          hasUnreadMention ||
          mentionCount - welcomeCount > 0 ||
          unreadCount - welcomeCount > 0
        );
      }
      return (
        summary?.hasUnreadMention === true ||
        (summary?.mentionCount ?? 0) > 0 ||
        (summary?.unreadCount ?? 0) > 0
      );
    }

    // Iterate per-channel summaries, excluding muted channels.
    const channelSectionMap = buildChannelSectionMap(groupSettings);
    let totalUnread = 0;
    let totalMention = 0;
    let anyUnreadMention = false;
    for (const ch of channels) {
      const chId = String(ch?.channelId || '');
      if (
        chId &&
        groupSettings &&
        isScopeMuted(groupSettings, channelSectionMap.get(chId), chId)
      ) {
        continue;
      }
      totalUnread += Number(ch?.unreadCount ?? 0);
      totalMention += Number(ch?.mentionCount ?? 0);
      if (ch?.hasUnreadMention === true) anyUnreadMention = true;
    }

    if (welcomeCount > 0) {
      return (
        anyUnreadMention ||
        totalMention - welcomeCount > 0 ||
        totalUnread - welcomeCount > 0
      );
    }
    return anyUnreadMention || totalMention > 0 || totalUnread > 0;
  }

  // Group is muted — check if any explicitly unmuted channel has unread.
  if (!groupSettings?.sections) return false;

  const channels = Array.isArray(summary?.channels) ? summary.channels : [];
  const channelSummariesById = new Map<string, any>();
  for (const ch of channels) {
    const chId = String(ch?.channelId || '');
    if (chId) channelSummariesById.set(chId, ch);
  }

  for (const section of Object.values(groupSettings.sections)) {
    if (!section?.channels) continue;
    for (const [channelId, channelSettings] of Object.entries(
      section.channels
    )) {
      if (channelSettings?.mutedUntil === EXPLICITLY_UNMUTED) {
        const chSummary = channelSummariesById.get(channelId);
        if (
          chSummary &&
          (chSummary?.hasUnreadMention === true ||
            (chSummary?.mentionCount ?? 0) > 0 ||
            (chSummary?.unreadCount ?? 0) > 0)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export async function getHideMutedChannels(
  groupId: string | number
): Promise<boolean> {
  const settings = await getGroupNotificationSettings(groupId);
  return settings.hideMutedChannels === true;
}

export async function setHideMutedChannels(
  groupId: string | number,
  value: boolean
): Promise<void> {
  const settings = await getGroupNotificationSettings(groupId);
  settings.hideMutedChannels = value;
  await setGroupNotificationSettings(groupId, settings);
}

export const MIGRATION_KEYS = {
  MIGRATION_FLAG: MIGRATION_FLAG_KEY,
  OLD_MENTION_DISABLED: OLD_MENTION_DISABLED_KEY,
  OLD_MUTED_GROUPS: OLD_MUTED_GROUPS_KEY,
};

// ---------------------------------------------------------------------------
// Welcome-post unread tracking helpers
//
// Pure functions that operate on the Record<string, Set<string>> structure
// stored in unreadWelcomeEventIdsAtom. Callers use useSetAtom to get the
// setter, then call these to produce the next value.
// ---------------------------------------------------------------------------

export type WelcomeUnreadMap = Record<string, Set<string>>;

export function addWelcomeUnreadEventId(
  map: WelcomeUnreadMap,
  groupId: string | number,
  eventId: string
): WelcomeUnreadMap {
  const key = String(groupId);
  const existing = map[key];
  if (existing?.has(eventId)) return map;
  const nextSet = new Set(existing);
  nextSet.add(eventId);
  return { ...map, [key]: nextSet };
}

export function removeWelcomeUnreadEventId(
  map: WelcomeUnreadMap,
  groupId: string | number,
  eventId: string
): WelcomeUnreadMap {
  const key = String(groupId);
  const existing = map[key];
  if (!existing?.has(eventId)) return map;
  const nextSet = new Set(existing);
  nextSet.delete(eventId);
  if (nextSet.size === 0) {
    const { [key]: _, ...rest } = map;
    return rest;
  }
  return { ...map, [key]: nextSet };
}

export function clearWelcomeUnreadForGroup(
  map: WelcomeUnreadMap,
  groupId: string | number
): WelcomeUnreadMap {
  const key = String(groupId);
  if (!map[key]) return map;
  const { [key]: _, ...rest } = map;
  return rest;
}

export function getWelcomeUnreadCount(
  map: WelcomeUnreadMap | undefined,
  groupId: string | number
): number {
  if (!map) return 0;
  return map[String(groupId)]?.size ?? 0;
}

/**
 * Returns the effective unread count after subtracting welcome-post unreads
 * when notifyOnWelcomePosts is false. Used by derived red-dot atoms.
 */
export function getEffectiveUnreadCount(
  summary: any,
  notifyOnWelcomePosts: boolean,
  welcomeUnreadCount: number
): number {
  const mentionCount = Number(summary?.mentionCount ?? 0);
  const unreadCount = Number(summary?.unreadCount ?? 0);
  const total = mentionCount + unreadCount;
  if (!notifyOnWelcomePosts && welcomeUnreadCount > 0) {
    return Math.max(0, total - welcomeUnreadCount);
  }
  return total;
}
