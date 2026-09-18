import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import {
  groupChatHasUnreadAtom,
  memberGroupsAtom,
  reticulumChatSummariesAtom,
  reticulumChatEnabledAtom,
  userInfoAtom,
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
  groupChatTimestampsAtom,
  timestampEnterDataAtom,
} from './global';
import type { GroupNotificationSettingsData } from '../utils/qChatNotificationSettings';

function setupStore(overrides: {
  groups?: any[];
  muteCache?: Record<string, GroupNotificationSettingsData>;
  myAddress?: string;
  reticulumChatEnabled?: boolean;
}) {
  const store = createStore();
  store.set(memberGroupsAtom, overrides.groups ?? []);
  // Set to null so memberGroupsWithReticulumChatAtom returns groups as-is
  store.set(reticulumChatSummariesAtom, null as any);
  store.set(reticulumChatEnabledAtom, overrides.reticulumChatEnabled ?? true);
  store.set(userInfoAtom, { address: overrides.myAddress ?? 'test-address' });
  store.set(notificationSettingsCacheAtom, overrides.muteCache ?? {});
  store.set(muteExpiryTickAtom, 0);
  store.set(groupChatTimestampsAtom, {});
  store.set(timestampEnterDataAtom, {});
  return store;
}

function renderHookWithStore(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useAtomValue(groupChatHasUnreadAtom), { wrapper });
}

// Need to import useAtomValue
import { useAtomValue } from 'jotai';

describe('groupChatHasUnreadAtom', () => {
  it('returns false when no groups', () => {
    const store = setupStore({ groups: [] });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when group has unread and is not muted', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when group is muted', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
      ],
      muteCache: {
        '1': { mutedUntil: null },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when expired mute', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
      ],
      muteCache: {
        '1': { mutedUntil: Date.now() - 60000 },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns true when one group muted but another has unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
        {
          groupId: '2',
          reticulumChatSummary: { unreadCount: 3, mentionCount: 0 },
        },
      ],
      muteCache: {
        '1': { mutedUntil: null },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('skips group 0 (General)', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '0',
          reticulumChatSummary: { unreadCount: 99, mentionCount: 0 },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when group is muted but has unmuted channel with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 3, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          mutedUntil: null,
          sections: {
            'sec-1': {
              channels: {
                'ch-1': { mutedUntil: 0 },
              },
            },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when group is muted and unmuted channel has no unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [
              { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
              { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
            ],
          },
        },
      ],
      muteCache: {
        '1': {
          mutedUntil: null,
          sections: {
            'sec-1': {
              channels: {
                'ch-1': { mutedUntil: 0 },
              },
            },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has non-muted channel with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {},
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when non-muted group has only muted channels with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          sections: {
            'sec-1': {
              channels: {
                'ch-1': { mutedUntil: null },
              },
            },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has mixed muted and non-muted channels with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 8,
            mentionCount: 0,
            channels: [
              { channelId: 'ch-1', unreadCount: 3, mentionCount: 0 },
              { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
            ],
          },
        },
      ],
      muteCache: {
        '1': {
          sections: {
            'sec-1': {
              channels: {
                'ch-1': { mutedUntil: null },
              },
            },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when muted group has channel with inherited mute and unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          mutedUntil: null,
          sections: {
            'sec-1': {
              channels: {
                'ch-1': { mutedUntil: undefined },
              },
            },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has empty channels array with aggregate unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [],
          },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });
});
