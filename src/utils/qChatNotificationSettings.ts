import { executeEvent } from './events';

export const NOTIFICATION_SETTINGS_UPDATED_EVENT =
  'q-chat-notification-settings-updated';
export const QCHAT_REPLY_NOTIFICATION_EVENT = 'Q_CHAT_REPLY';

export type PushLevel = 'all' | 'mentions' | 'none';

export interface ScopeNotificationSettings {
  pushLevel?: PushLevel;
  suppressEveryoneHere?: boolean;
  notifyOnReplies?: boolean;
}

export interface ChannelNotificationSettings extends ScopeNotificationSettings {}

export interface SectionNotificationSettings extends ScopeNotificationSettings {
  channels?: Record<string, ChannelNotificationSettings>;
}

export interface GroupNotificationSettingsData extends ScopeNotificationSettings {
  sections?: Record<string, SectionNotificationSettings>;
}

export interface EffectiveNotificationSettings {
  pushLevel: PushLevel;
  suppressEveryoneHere: boolean;
  notifyOnReplies: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: EffectiveNotificationSettings = {
  pushLevel: 'mentions',
  suppressEveryoneHere: false,
  notifyOnReplies: false,
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
  let result: EffectiveNotificationSettings = {
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
  settings: ScopeNotificationSettings
): Promise<void> {
  const groupSettings = await getGroupNotificationSettings(scope.groupId);

  if (!scope.sectionId && !scope.channelId) {
    Object.assign(groupSettings, settings);
  } else if (scope.sectionId) {
    if (!groupSettings.sections) groupSettings.sections = {};
    if (!groupSettings.sections[scope.sectionId])
      groupSettings.sections[scope.sectionId] = {};

    if (!scope.channelId) {
      Object.assign(groupSettings.sections[scope.sectionId], settings);
    } else {
      const section = groupSettings.sections[scope.sectionId];
      if (!section.channels) section.channels = {};
      if (!section.channels[scope.channelId])
        section.channels[scope.channelId] = {};
      Object.assign(section.channels[scope.channelId], settings);
    }
  }

  await setGroupNotificationSettings(scope.groupId, groupSettings);
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

export const MIGRATION_KEYS = {
  MIGRATION_FLAG: MIGRATION_FLAG_KEY,
  OLD_MENTION_DISABLED: OLD_MENTION_DISABLED_KEY,
  OLD_MUTED_GROUPS: OLD_MUTED_GROUPS_KEY,
};
