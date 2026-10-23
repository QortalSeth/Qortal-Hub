import { describe, expect, it } from 'vitest';
import {
  NOT_VIEWING_VIEW_CONTEXT,
  getReticulumChannelDismissalTarget,
  getReticulumViewChannelPayload,
} from './reticulumChannelDismissal';
import { shouldSuppressForViewedChannel } from '../../utils/qChatViewContextSuppression';

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

describe('getReticulumViewChannelPayload', () => {
  it('publishes the active channel', () => {
    expect(getReticulumViewChannelPayload(base)).toEqual({
      groupId: 7,
      channelId: 'general',
    });
  });

  it('publishes the not-viewing sentinel when inactive', () => {
    // Regression: ChatGroup stays mounted inside PersistentSectionLayer, so
    // leaving the chat view only flips isActive. Skipping the publish instead
    // of sending a sentinel left main holding the last channel forever, which
    // suppressed every notification for it — General Chat stopped notifying.
    const payload = getReticulumViewChannelPayload({
      ...base,
      isActive: false,
    });
    expect(payload).toEqual(NOT_VIEWING_VIEW_CONTEXT);
    expect(payload.groupId).toBeLessThan(0);
  });

  it('never returns null, so a stale context can never survive', () => {
    const invalidStates = [
      { reticulumChatEnabled: false },
      { isActive: false },
      { selectedGroup: null },
      { selectedGroup: 'abc' },
      { selectedChannelId: '' },
      { selectedChannelId: null },
    ];
    for (const overrides of invalidStates) {
      const payload = getReticulumViewChannelPayload({
        ...base,
        ...overrides,
      } as any);
      expect(payload).toEqual(NOT_VIEWING_VIEW_CONTEXT);
    }
  });

  it('the sentinel suppresses nothing for any real channel', () => {
    const payload = getReticulumViewChannelPayload({
      ...base,
      isActive: false,
    });
    const context = { ...payload, visible: true };
    expect(shouldSuppressForViewedChannel(context, 7, 'general')).toBe(false);
    expect(shouldSuppressForViewedChannel(context, 1, 'general')).toBe(false);
  });

  it('an active channel still suppresses for itself', () => {
    const payload = getReticulumViewChannelPayload(base);
    const context = { ...payload, visible: true };
    expect(shouldSuppressForViewedChannel(context, 7, 'general')).toBe(true);
    expect(shouldSuppressForViewedChannel(context, 7, 'announcements')).toBe(
      false
    );
  });
});
