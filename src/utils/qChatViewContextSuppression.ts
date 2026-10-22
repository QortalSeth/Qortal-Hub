/**
 * View-context suppression predicate for Q-Chat group channel notifications.
 *
 * One rule decides whether an OS notification should be suppressed because the
 * user is currently looking at the channel it targets:
 *
 *     visible && context.groupId === groupId && context.channelId === channelId
 *
 * Scroll position is deliberately NOT part of the predicate. Being scrolled up
 * in the channel you have open still counts as viewing it.
 *
 * The same rule is evaluated in two places:
 *   - the renderer, at submit time, as a cheap early-out (WebsocketNotifications)
 *   - the Electron main process, at show time, as the authoritative gate
 *     (electron/src/setup.ts), because notifications are shown from a queue
 *     with a multi-second delay and the renderer state at submit time may be
 *     stale by the time the notification is actually presented.
 *
 * electron/ is a separate npm project and cannot import this file, so the
 * three-clause predicate is mirrored there. Keep the two in sync; both are
 * covered by tests.
 */

export const DEFAULT_NOT_VIEWING_GROUP_ID = -1;

export interface QChatViewContext {
  groupId: number;
  channelId: string;
  visible: boolean;
}

export function isViewContextActive(
  context: QChatViewContext | null | undefined
) {
  if (!context) return false;
  return Number.isFinite(context.groupId) && context.groupId >= 0;
}

export function shouldSuppressForViewedChannel(
  context: QChatViewContext | null | undefined,
  groupId: number,
  channelId: string
): boolean {
  if (!context) return false;
  if (context.visible !== true) return false;
  if (!isViewContextActive(context)) return false;
  return context.groupId === groupId && context.channelId === channelId;
}

/**
 * `visible` is true only when the document is visible AND the window has focus.
 * `document.visibilityState` alone is insufficient: a focused-but-minimised
 * Electron window on Linux and Windows can still report `visible`.
 */
export function computeQChatVisible(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  return typeof document.hasFocus === 'function' ? document.hasFocus() : false;
}
