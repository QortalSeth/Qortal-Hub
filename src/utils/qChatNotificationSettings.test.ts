import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEffectiveSettings,
  shouldFirePushNotification,
  migrateNotificationSettings,
  getGroupNotificationSettings,
  setGroupNotificationSettings,
  getEffectiveNotificationSettings,
  setScopeNotificationSettings,
  isScopeMuted,
  setScopeMuted,
  unmuteScope,
  getHideMutedChannels,
  setHideMutedChannels,
  groupHasUnreadConsideringMute,
  addWelcomeUnreadEventId,
  removeWelcomeUnreadEventId,
  clearWelcomeUnreadForGroup,
  getWelcomeUnreadCount,
  getEffectiveUnreadCount,
  applyNotificationSettingsToAllGroups,
  DEFAULT_NOTIFICATION_SETTINGS,
  type GroupNotificationSettingsData,
} from './qChatNotificationSettings';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockSendMessage(map: Record<string, unknown>) {
  vi.stubGlobal('window', {
    ...window,
    sendMessage: vi.fn(async (type: string, opts: { key?: string }) => {
      if (type === 'getUserSettings' && opts?.key) {
        return map[opts.key] ?? null;
      }
      if (type === 'addUserSettings') {
        return { error: null };
      }
      return null;
    }),
  });
}

describe('resolveEffectiveSettings', () => {
  it('returns defaults when no settings stored', () => {
    const result = resolveEffectiveSettings({});
    expect(result).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('uses group-level settings when no section/channel override', () => {
    const settings: GroupNotificationSettingsData = {
      pushLevel: 'all',
      suppressEveryoneHere: true,
      notifyOnReplies: true,
    };
    const result = resolveEffectiveSettings(settings);
    expect(result).toEqual({
      pushLevel: 'all',
      suppressEveryoneHere: true,
      notifyOnReplies: true,
      notifyOnWelcomePosts: true,
    });
  });

  it('section override wins over group setting', () => {
    const settings: GroupNotificationSettingsData = {
      pushLevel: 'all',
      sections: {
        'sec-1': {
          pushLevel: 'none',
        },
      },
    };
    const result = resolveEffectiveSettings(settings, 'sec-1');
    expect(result.pushLevel).toBe('none');
    expect(result.suppressEveryoneHere).toBe(false);
  });

  it('channel override wins over section and group', () => {
    const settings: GroupNotificationSettingsData = {
      pushLevel: 'all',
      sections: {
        'sec-1': {
          pushLevel: 'none',
          channels: {
            'ch-1': {
              pushLevel: 'mentions',
            },
          },
        },
      },
    };
    const result = resolveEffectiveSettings(settings, 'sec-1', 'ch-1');
    expect(result.pushLevel).toBe('mentions');
  });

  it('section without channel override inherits section value', () => {
    const settings: GroupNotificationSettingsData = {
      pushLevel: 'all',
      sections: {
        'sec-1': {
          pushLevel: 'mentions',
          suppressEveryoneHere: true,
          channels: {
            'ch-1': {
              notifyOnReplies: true,
            },
          },
        },
      },
    };
    const result = resolveEffectiveSettings(settings, 'sec-1', 'ch-1');
    expect(result.pushLevel).toBe('mentions');
    expect(result.suppressEveryoneHere).toBe(true);
    expect(result.notifyOnReplies).toBe(true);
  });
});

describe('shouldFirePushNotification', () => {
  const base = DEFAULT_NOTIFICATION_SETTINGS;

  it('fires for all messages when pushLevel is all', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'all' },
        false,
        false,
        false
      )
    ).toBe(true);
  });

  it('fires for mentions when pushLevel is mentions and not suppressed', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'mentions' },
        true,
        false,
        false
      )
    ).toBe(true);
  });

  it('does not fire for non-mentions when pushLevel is mentions', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'mentions' },
        false,
        false,
        false
      )
    ).toBe(false);
  });

  it('suppresses @everyone when suppressEveryoneHere is true', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'mentions', suppressEveryoneHere: true },
        true,
        true,
        false
      )
    ).toBe(false);
  });

  it('does not suppress @name mentions when suppressEveryoneHere is true', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'mentions', suppressEveryoneHere: true },
        true,
        false,
        false
      )
    ).toBe(true);
  });

  it('does not fire when pushLevel is none and no reply', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'none' },
        true,
        false,
        false
      )
    ).toBe(false);
  });

  it('fires for reply when notifyOnReplies is true even with none', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'none', notifyOnReplies: true },
        false,
        false,
        true
      )
    ).toBe(true);
  });

  it('all messages overrides suppress for @everyone', () => {
    expect(
      shouldFirePushNotification(
        { ...base, pushLevel: 'all', suppressEveryoneHere: true },
        true,
        true,
        false
      )
    ).toBe(true);
  });
});

describe('setScopeNotificationSettings', () => {
  it('writes group-level settings', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await setScopeNotificationSettings({ groupId: 123 }, { pushLevel: 'none' });

    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.pushLevel).toBe('none');
  });

  it('writes section-level override within group JSON', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await setScopeNotificationSettings(
      { groupId: 123, sectionId: 'sec-1' },
      { pushLevel: 'all' }
    );

    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['sec-1']?.pushLevel).toBe('all');
  });

  it('writes channel-level override within section JSON', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await setScopeNotificationSettings(
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      { notifyOnReplies: true }
    );

    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(
      stored.sections?.['sec-1']?.channels?.['ch-1']?.notifyOnReplies
    ).toBe(true);
  });
});

describe('migrateNotificationSettings', () => {
  it('skips when already migrated', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { ...window, sendMessage });

    await migrateNotificationSettings([1, 2, 3]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sets groups to none when old mention setting was disabled', async () => {
    const store: Record<string, unknown> = {
      'q-chat-notification-settings-migrated': false,
      'q-chat-mention-notifications-disabled': true,
      mutedGroups: [],
    };
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await migrateNotificationSettings([1, 2]);

    const s1 = store[
      'q-chat-notification-settings-1'
    ] as GroupNotificationSettingsData;
    const s2 = store[
      'q-chat-notification-settings-2'
    ] as GroupNotificationSettingsData;
    expect(s1?.pushLevel).toBe('none');
    expect(s2?.pushLevel).toBe('none');
    expect(store['q-chat-notification-settings-migrated']).toBe(true);
  });

  it('sets muted groups to none', async () => {
    const store: Record<string, unknown> = {
      'q-chat-notification-settings-migrated': false,
      'q-chat-mention-notifications-disabled': false,
      mutedGroups: [5, 6],
    };
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await migrateNotificationSettings([5, 6, 7]);

    const s5 = store[
      'q-chat-notification-settings-5'
    ] as GroupNotificationSettingsData;
    const s6 = store[
      'q-chat-notification-settings-6'
    ] as GroupNotificationSettingsData;
    const s7 = store['q-chat-notification-settings-7'];
    expect(s5?.pushLevel).toBe('none');
    expect(s6?.pushLevel).toBe('none');
    expect(s7).toBeUndefined();
  });

  it('does not overwrite existing settings', async () => {
    const store: Record<string, unknown> = {
      'q-chat-notification-settings-migrated': false,
      'q-chat-mention-notifications-disabled': true,
      mutedGroups: [],
      'q-chat-notification-settings-1': { pushLevel: 'all' },
    };
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await migrateNotificationSettings([1, 2]);

    const s1 = store[
      'q-chat-notification-settings-1'
    ] as GroupNotificationSettingsData;
    expect(s1.pushLevel).toBe('all');
  });
});

describe('getEffectiveNotificationSettings (async)', () => {
  it('returns defaults when no settings stored', async () => {
    mockSendMessage({});
    const result = await getEffectiveNotificationSettings(123);
    expect(result).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('resolves group-level settings', async () => {
    mockSendMessage({
      'q-chat-notification-settings-123': { pushLevel: 'all' },
    });
    const result = await getEffectiveNotificationSettings(123);
    expect(result.pushLevel).toBe('all');
  });
});

describe('getGroupNotificationSettings', () => {
  it('returns empty object when no settings stored', async () => {
    mockSendMessage({});
    const result = await getGroupNotificationSettings(456);
    expect(result).toEqual({});
  });

  it('returns stored settings', async () => {
    mockSendMessage({
      'q-chat-notification-settings-456': { pushLevel: 'none' },
    });
    const result = await getGroupNotificationSettings(456);
    expect(result.pushLevel).toBe('none');
  });
});

describe('setGroupNotificationSettings', () => {
  it('writes settings and fires event', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });

    await setGroupNotificationSettings(789, { pushLevel: 'mentions' });

    expect(store['q-chat-notification-settings-789']).toEqual({
      pushLevel: 'mentions',
    });
  });
});

describe('isScopeMuted', () => {
  it('returns false when no mutedUntil set at any level', () => {
    const settings: GroupNotificationSettingsData = {};
    expect(isScopeMuted(settings)).toBe(false);
    expect(isScopeMuted(settings, 'sec-1')).toBe(false);
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(false);
  });

  it('returns true when group is muted with future timestamp', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: Date.now() + 60_000,
    };
    expect(isScopeMuted(settings)).toBe(true);
  });

  it('returns true when group is muted indefinitely (null)', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
    };
    expect(isScopeMuted(settings)).toBe(true);
  });

  it('returns false when group mute has expired', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: Date.now() - 60_000,
    };
    expect(isScopeMuted(settings)).toBe(false);
  });

  it('cascades from group to channel', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: Date.now() + 60_000,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': {},
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(true);
  });

  it('cascades from section to channel', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          mutedUntil: Date.now() + 60_000,
          channels: {
            'ch-1': {},
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(true);
  });

  it('channel mute does not affect siblings', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: Date.now() + 60_000 },
            'ch-2': {},
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(true);
    expect(isScopeMuted(settings, 'sec-1', 'ch-2')).toBe(false);
  });

  it('channel own mute wins over section unmute', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          mutedUntil: undefined,
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(true);
  });

  it('channel in default category (no sectionId) is muted via empty-string section', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        '': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(true);
  });

  it('channel in default category with empty-string sectionId is muted', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        '': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    expect(isScopeMuted(settings, '', 'ch-1')).toBe(true);
  });

  it('channel unmute (0) overrides group mute', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(false);
  });

  it('channel unmute (0) overrides section mute', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          mutedUntil: null,
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(false);
  });

  it('section unmute (0) overrides group mute', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          mutedUntil: 0,
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1')).toBe(false);
  });

  it('channel mute overrides section unmute', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          mutedUntil: 0,
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(true);
  });

  it('channel unmute in default category overrides group mute', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        '': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(false);
  });

  it('sibling channel still muted when one channel is unmuted', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
            'ch-2': { mutedUntil: undefined },
          },
        },
      },
    };
    expect(isScopeMuted(settings, 'sec-1', 'ch-1')).toBe(false);
    expect(isScopeMuted(settings, 'sec-1', 'ch-2')).toBe(true);
  });
});

describe('setScopeMuted / unmuteScope', () => {
  function createStoreMock() {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });
    return store;
  }

  it('writes mutedUntil at group root', async () => {
    const store = createStoreMock();
    const ts = Date.now() + 3600_000;
    await setScopeMuted({ groupId: 123 }, ts);
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.mutedUntil).toBe(ts);
  });

  it('writes mutedUntil at section level', async () => {
    const store = createStoreMock();
    await setScopeMuted({ groupId: 123, sectionId: 'sec-1' }, null);
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['sec-1']?.mutedUntil).toBeNull();
  });

  it('writes mutedUntil at channel level', async () => {
    const store = createStoreMock();
    const ts = Date.now() + 900_000;
    await setScopeMuted(
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      ts
    );
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['sec-1']?.channels?.['ch-1']?.mutedUntil).toBe(ts);
  });

  it('unmuteScope clears mutedUntil at channel level', async () => {
    const store = createStoreMock();
    await setScopeMuted(
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      null
    );
    await unmuteScope({
      groupId: 123,
      sectionId: 'sec-1',
      channelId: 'ch-1',
    });
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['sec-1']?.channels?.['ch-1']?.mutedUntil).toBe(0);
  });

  it('writes mutedUntil for channel in default category (no sectionId)', async () => {
    const store = createStoreMock();
    await setScopeMuted({ groupId: 123, channelId: 'ch-1' }, null);
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['']?.channels?.['ch-1']?.mutedUntil).toBeNull();
  });

  it('writes mutedUntil for channel with empty-string sectionId', async () => {
    const store = createStoreMock();
    await setScopeMuted(
      { groupId: 123, sectionId: '', channelId: 'ch-1' },
      null
    );
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.sections?.['']?.channels?.['ch-1']?.mutedUntil).toBeNull();
  });
});

describe('getHideMutedChannels / setHideMutedChannels', () => {
  function createStoreMock(initial?: Record<string, unknown>) {
    const store: Record<string, unknown> = { ...initial };
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });
    return store;
  }

  it('getHideMutedChannels returns false by default', async () => {
    createStoreMock({});
    const result = await getHideMutedChannels(123);
    expect(result).toBe(false);
  });

  it('getHideMutedChannels returns true when set', async () => {
    createStoreMock({
      'q-chat-notification-settings-123': { hideMutedChannels: true },
    });
    const result = await getHideMutedChannels(123);
    expect(result).toBe(true);
  });

  it('setHideMutedChannels writes to group root', async () => {
    const store = createStoreMock();
    await setHideMutedChannels(123, true);
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.hideMutedChannels).toBe(true);
  });

  it('setHideMutedChannels preserves existing settings', async () => {
    const store = createStoreMock({
      'q-chat-notification-settings-123': { pushLevel: 'none' },
    });
    await setHideMutedChannels(123, true);
    const stored = store[
      'q-chat-notification-settings-123'
    ] as GroupNotificationSettingsData;
    expect(stored.hideMutedChannels).toBe(true);
    expect(stored.pushLevel).toBe('none');
  });
});

describe('groupHasUnreadConsideringMute', () => {
  it('returns true when group is not muted and has unread', () => {
    const settings: GroupNotificationSettingsData = {};
    const summary = { unreadCount: 5, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when group is not muted and no unread', () => {
    const settings: GroupNotificationSettingsData = {};
    const summary = { unreadCount: 0, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns false when group is muted and no unmuted channels', () => {
    const settings: GroupNotificationSettingsData = { mutedUntil: null };
    const summary = { unreadCount: 5, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns true when group is muted but an unmuted channel has unread', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [
        { channelId: 'ch-1', unreadCount: 3, mentionCount: 0 },
        { channelId: 'ch-2', unreadCount: 2, mentionCount: 0 },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when group is muted and unmuted channel has no unread', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [
        { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns true when group is muted and unmuted channel has mention', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    const summary = {
      unreadCount: 0,
      mentionCount: 1,
      hasUnreadMention: true,
      channels: [
        {
          channelId: 'ch-1',
          unreadCount: 0,
          mentionCount: 1,
          hasUnreadMention: true,
        },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when no summary provided', () => {
    const settings: GroupNotificationSettingsData = {};
    expect(groupHasUnreadConsideringMute(settings, null)).toBe(false);
  });

  it('returns true when group is muted and unmuted channel in default section has unread', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        '': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    };
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns true when non-muted group has non-muted channel with unread', () => {
    const settings: GroupNotificationSettingsData = {};
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when non-muted group has only muted channels with unread', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns true when non-muted group has mixed muted and non-muted channels', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    const summary = {
      unreadCount: 8,
      mentionCount: 0,
      channels: [
        { channelId: 'ch-1', unreadCount: 3, mentionCount: 0 },
        { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when muted group has channel with inherited mute (mutedUntil undefined)', () => {
    const settings: GroupNotificationSettingsData = {
      mutedUntil: null,
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: undefined },
          },
        },
      },
    };
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns true when non-muted group has empty channels array with aggregate unread', () => {
    const settings: GroupNotificationSettingsData = {};
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      channels: [] as any[],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('excludes muted channel unread but includes non-muted channel mention in non-muted group', () => {
    const settings: GroupNotificationSettingsData = {
      sections: {
        'sec-1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    };
    const summary = {
      unreadCount: 3,
      mentionCount: 1,
      hasUnreadMention: true,
      channels: [
        { channelId: 'ch-1', unreadCount: 3, mentionCount: 0 },
        {
          channelId: 'ch-2',
          unreadCount: 0,
          mentionCount: 1,
          hasUnreadMention: true,
        },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });
});

describe('resolveEffectiveSettings — notifyOnWelcomePosts', () => {
  it('defaults to true when not stored', () => {
    const result = resolveEffectiveSettings({});
    expect(result.notifyOnWelcomePosts).toBe(true);
  });

  it('returns false when stored as false', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: false,
    };
    const result = resolveEffectiveSettings(settings);
    expect(result.notifyOnWelcomePosts).toBe(false);
  });

  it('returns true when stored as true', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: true,
    };
    const result = resolveEffectiveSettings(settings);
    expect(result.notifyOnWelcomePosts).toBe(true);
  });

  it('does not inherit from section or channel', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: false,
      sections: {
        'sec-1': {
          // @ts-expect-error — notifyOnWelcomePosts is not in ScopeNotificationSettings
          notifyOnWelcomePosts: true,
        },
      },
    };
    const result = resolveEffectiveSettings(settings, 'sec-1');
    expect(result.notifyOnWelcomePosts).toBe(false);
  });
});

describe('groupHasUnreadConsideringMute — welcomeUnreadCount', () => {
  it('subtracts welcome count when notifyOnWelcomePosts is false', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: false,
    };
    const summary = { unreadCount: 1, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary, 1)).toBe(false);
  });

  it('does not subtract when notifyOnWelcomePosts is true', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: true,
    };
    const summary = { unreadCount: 1, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary, 1)).toBe(true);
  });

  it('does not subtract when notifyOnWelcomePosts is undefined (default)', () => {
    const settings: GroupNotificationSettingsData = {};
    const summary = { unreadCount: 1, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary, 1)).toBe(true);
  });

  it('subtracts from mentionCount when notifyOnWelcomePosts is false', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: false,
    };
    const summary = { unreadCount: 0, mentionCount: 2 };
    expect(groupHasUnreadConsideringMute(settings, summary, 2)).toBe(false);
  });

  it('shows unread when non-welcome messages remain after subtraction', () => {
    const settings: GroupNotificationSettingsData = {
      notifyOnWelcomePosts: false,
    };
    const summary = { unreadCount: 3, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary, 1)).toBe(true);
  });
});

describe('welcome-post tracking helpers', () => {
  it('addWelcomeUnreadEventId adds event ID', () => {
    const map = {};
    const next = addWelcomeUnreadEventId(map, 'group-1', 'evt-1');
    expect(next['group-1']).toEqual(new Set(['evt-1']));
  });

  it('addWelcomeUnreadEventId is idempotent', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    const next = addWelcomeUnreadEventId(map, 'group-1', 'evt-1');
    expect(next).toBe(map);
  });

  it('addWelcomeUnreadEventId preserves other groups', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    const next = addWelcomeUnreadEventId(map, 'group-2', 'evt-2');
    expect(next['group-1']).toEqual(new Set(['evt-1']));
    expect(next['group-2']).toEqual(new Set(['evt-2']));
  });

  it('removeWelcomeUnreadEventId removes event ID', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    const next = removeWelcomeUnreadEventId(map, 'group-1', 'evt-1');
    expect(next['group-1']).toBeUndefined();
  });

  it('removeWelcomeUnreadEventId is no-op when not found', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    const next = removeWelcomeUnreadEventId(map, 'group-1', 'evt-2');
    expect(next).toBe(map);
  });

  it('clearWelcomeUnreadForGroup removes the group entry', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    const next = clearWelcomeUnreadForGroup(map, 'group-1');
    expect(next['group-1']).toBeUndefined();
  });

  it('clearWelcomeUnreadForGroup is no-op when not found', () => {
    const map = {};
    const next = clearWelcomeUnreadForGroup(map, 'group-1');
    expect(next).toBe(map);
  });

  it('getWelcomeUnreadCount returns 0 for undefined map', () => {
    expect(getWelcomeUnreadCount(undefined, 'group-1')).toBe(0);
  });

  it('getWelcomeUnreadCount returns set size', () => {
    const map = addWelcomeUnreadEventId(
      addWelcomeUnreadEventId({}, 'group-1', 'evt-1'),
      'group-1',
      'evt-2'
    );
    expect(getWelcomeUnreadCount(map, 'group-1')).toBe(2);
  });

  it('getWelcomeUnreadCount returns 0 for unknown group', () => {
    const map = addWelcomeUnreadEventId({}, 'group-1', 'evt-1');
    expect(getWelcomeUnreadCount(map, 'group-2')).toBe(0);
  });
});

describe('getEffectiveUnreadCount', () => {
  it('returns total when notifyOnWelcomePosts is true', () => {
    expect(
      getEffectiveUnreadCount({ unreadCount: 3, mentionCount: 2 }, true, 2)
    ).toBe(5);
  });

  it('subtracts welcome count when notifyOnWelcomePosts is false', () => {
    expect(
      getEffectiveUnreadCount({ unreadCount: 1, mentionCount: 2 }, false, 1)
    ).toBe(2);
  });

  it('clamps to 0 when welcome count exceeds total', () => {
    expect(
      getEffectiveUnreadCount({ unreadCount: 1, mentionCount: 0 }, false, 5)
    ).toBe(0);
  });
});

describe('applyNotificationSettingsToAllGroups', () => {
  function createStoreMock(initial?: Record<string, unknown>) {
    const store: Record<string, unknown> = { ...initial };
    vi.stubGlobal('window', {
      ...window,
      sendMessage: vi.fn(
        async (
          type: string,
          opts: { key?: string; keyValue?: { key: string; value: unknown } }
        ) => {
          if (type === 'getUserSettings' && opts?.key) {
            return store[opts.key] ?? null;
          }
          if (type === 'addUserSettings' && opts?.keyValue) {
            store[opts.keyValue.key] = opts.keyValue.value;
            return { error: null };
          }
          return null;
        }
      ),
    });
    return store;
  }

  it('writes to all provided groups', async () => {
    const store = createStoreMock();

    await applyNotificationSettingsToAllGroups([1, 2, 3], {
      pushLevel: 'none',
    });

    for (const id of [1, 2, 3]) {
      const stored = store[
        `q-chat-notification-settings-${id}`
      ] as GroupNotificationSettingsData;
      expect(stored.pushLevel).toBe('none');
    }
  });

  it('preserves section and channel overrides', async () => {
    const store = createStoreMock({
      'q-chat-notification-settings-1': {
        pushLevel: 'all',
        sections: {
          'sec-1': {
            pushLevel: 'mentions',
            channels: {
              'ch-1': {
                pushLevel: 'none',
              },
            },
          },
        },
      },
    });

    await applyNotificationSettingsToAllGroups([1], {
      pushLevel: 'none',
      hideMutedChannels: true,
    });

    const stored = store[
      'q-chat-notification-settings-1'
    ] as GroupNotificationSettingsData;

    expect(stored.pushLevel).toBe('none');
    expect(stored.hideMutedChannels).toBe(true);
    expect(stored.sections?.['sec-1']?.pushLevel).toBe('mentions');
    expect(stored.sections?.['sec-1']?.channels?.['ch-1']?.pushLevel).toBe(
      'none'
    );
  });

  it('handles empty group list without error', async () => {
    const store = createStoreMock();

    await applyNotificationSettingsToAllGroups([], { pushLevel: 'all' });

    expect(Object.keys(store).length).toBe(0);
  });

  it('writes all notification fields including hideMutedChannels', async () => {
    const store = createStoreMock();

    await applyNotificationSettingsToAllGroups([1], {
      pushLevel: 'mentions',
      suppressEveryoneHere: true,
      notifyOnReplies: false,
      notifyOnWelcomePosts: false,
      hideMutedChannels: true,
    });

    const stored = store[
      'q-chat-notification-settings-1'
    ] as GroupNotificationSettingsData;

    expect(stored.pushLevel).toBe('mentions');
    expect(stored.suppressEveryoneHere).toBe(true);
    expect(stored.notifyOnReplies).toBe(false);
    expect(stored.notifyOnWelcomePosts).toBe(false);
    expect(stored.hideMutedChannels).toBe(true);
  });
});
