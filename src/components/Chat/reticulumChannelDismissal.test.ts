import { describe, expect, it } from 'vitest';
import { getReticulumChannelDismissalTarget } from './reticulumChannelDismissal';

const base = {
  reticulumChatEnabled: true,
  isActive: true,
  selectedGroup: '7',
  selectedChannelId: 'general',
};

describe('getReticulumChannelDismissalTarget', () => {
  it('targets the selected group and channel', () => {
    expect(getReticulumChannelDismissalTarget(base)).toEqual({
      groupId: 7,
      channelId: 'general',
    });
  });

  it('is independent of unread count, deferral, and loaded events', () => {
    // The bug: dismissal used to sit behind the read effect's early returns, so
    // a channel with no unread count, or one whose markRead was deferred, never
    // got dismissed. None of that is an input here by design.
    expect(getReticulumChannelDismissalTarget(base)).not.toBeNull();
    expect(
      getReticulumChannelDismissalTarget({ ...base, unreadCount: 0 } as any)
    ).not.toBeNull();
    expect(
      getReticulumChannelDismissalTarget({
        ...base,
        hasLoadedEvents: false,
      } as any)
    ).not.toBeNull();
  });

  it('accepts a numeric group id', () => {
    expect(
      getReticulumChannelDismissalTarget({ ...base, selectedGroup: 7 })
    ).toEqual({ groupId: 7, channelId: 'general' });
  });

  it('returns null when Reticulum chat is disabled', () => {
    expect(
      getReticulumChannelDismissalTarget({
        ...base,
        reticulumChatEnabled: false,
      })
    ).toBeNull();
  });

  it('returns null when the view is not active', () => {
    expect(
      getReticulumChannelDismissalTarget({ ...base, isActive: false })
    ).toBeNull();
  });

  it('returns null for a missing or invalid group id', () => {
    for (const selectedGroup of [null, undefined, '', 'abc', 0, -1, 1.5]) {
      expect(
        getReticulumChannelDismissalTarget({ ...base, selectedGroup } as any)
      ).toBeNull();
    }
  });

  it('returns null for a missing channel id', () => {
    for (const selectedChannelId of [null, undefined, '']) {
      expect(
        getReticulumChannelDismissalTarget({
          ...base,
          selectedChannelId,
        } as any)
      ).toBeNull();
    }
  });
});
