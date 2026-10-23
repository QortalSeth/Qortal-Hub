/**
 * Pure decision helper for the Q-Chat "dismiss OS notifications for the
 * channel on screen" effect.
 *
 * The effect itself is deliberately separate from the read effect, because
 * dismissal has no timestamp, unread-count, or loaded-event precondition. The
 * read effect gates `markRead` behind a deferral so the unread divider
 * survives scroll restoration; keeping dismissal there meant it sat downstream
 * of early returns and was skipped whenever the selected channel was already
 * the stored channel. This helper makes the decision testable without mounting
 * a 13k-line component.
 */

import { DEFAULT_NOT_VIEWING_GROUP_ID } from '../../utils/qChatViewContextSuppression';

export interface DismissalTarget {
  groupId: number;
  channelId: string;
}

export interface ViewChannelPayload {
  groupId: number;
  channelId: string;
}

/**
 * Explicit "the user is no longer looking at any Q-Chat channel" payload.
 *
 * This MUST be published rather than skipping the publish. ChatGroup lives
 * inside a PersistentSectionLayer and stays mounted for the lifetime of the
 * group view, so an early return would leave the main process holding the
 * last-published channel indefinitely. Because the window stays focused while
 * the user browses other sections, `visible` still reads true, and every
 * notification for that channel would be suppressed forever.
 */
export const NOT_VIEWING_VIEW_CONTEXT: ViewChannelPayload = {
  groupId: DEFAULT_NOT_VIEWING_GROUP_ID,
  channelId: '',
};

export function getReticulumChannelDismissalTarget(params: {
  reticulumChatEnabled: boolean;
  isActive: boolean;
  selectedGroup: string | number | null | undefined;
  selectedChannelId: string | null | undefined;
}): DismissalTarget | null {
  if (!params.reticulumChatEnabled) return null;
  if (!params.isActive) return null;
  if (params.selectedGroup === null || params.selectedGroup === undefined) {
    return null;
  }
  if (params.selectedGroup === '') return null;
  const groupId = Number(params.selectedGroup);
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const channelId = params.selectedChannelId;
  if (typeof channelId !== 'string' || channelId.length === 0) return null;
  return { groupId, channelId };
}

/**
 * The channel-view payload to publish, which is never null: inactive or
 * invalid states resolve to the not-viewing sentinel so a stale context can
 * never survive.
 */
export function getReticulumViewChannelPayload(params: {
  reticulumChatEnabled: boolean;
  isActive: boolean;
  selectedGroup: string | number | null | undefined;
  selectedChannelId: string | null | undefined;
}): ViewChannelPayload {
  return getReticulumChannelDismissalTarget(params) ?? NOT_VIEWING_VIEW_CONTEXT;
}
