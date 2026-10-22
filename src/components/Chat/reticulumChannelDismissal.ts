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

export interface DismissalTarget {
  groupId: number;
  channelId: string;
}

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
