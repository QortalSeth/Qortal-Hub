import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEffectiveSettings,
  shouldFirePushNotification,
  migrateNotificationSettings,
  getGroupNotificationSettings,
  setGroupNotificationSettings,
  getEffectiveNotificationSettings,
  setScopeNotificationSettings,
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
