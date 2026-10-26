/**
 * Notification-type precedence for Q-Chat group posts.
 *
 * A single post can match several notification kinds at once: a reply that also
 * mentions the reader, a mention that also matches "all messages", and so on.
 * Each post must produce **at most one** OS notification, and it must be the
 * most specific kind that applies. Emitting one per matched kind produced two
 * notifications for one post whenever the push level was "all".
 *
 * Precedence, most specific first:
 *
 *   reply  >  mention  >  message
 *
 * Reactions are a different event type (`reaction_add`) and never compete with
 * these — a reaction is never also a message.
 *
 * The emitter in `Group.tsx` evaluates these in order and stops at the first
 * kind that fires. This module exists because the ordering was previously
 * implicit in nested booleans, and one of the guards read variables that were
 * only assigned inside an earlier branch — so "skipped" and "not applicable"
 * were indistinguishable, and the generic notification fired alongside the
 * specific one.
 */

export type ReticulumNotificationKind = 'reply' | 'mention' | 'message';

/** Highest precedence first. */
export const RETICULUM_NOTIFICATION_PRECEDENCE: readonly ReticulumNotificationKind[] =
  ['reply', 'mention', 'message'];

export interface NotificationKindContext {
  /** The post is a message (not an edit, delete, or reaction). */
  isMessage: boolean;
  /** The author is someone other than the reader. */
  isFromOther: boolean;
  /** The reader's own address is known. */
  hasMyAddress: boolean;
  /**
   * The post replies to a message authored by the reader, AND a reply
   * notification is permitted (settings allow it, channel not muted, and the
   * caller did not suppress reply lookups).
   */
  isReplyToMe: boolean;
  /**
   * The post mentions the reader directly, or via `@everyone` / `@here` where
   * the reader is authorised to receive it — AND a mention notification is
   * permitted.
   */
  isMentionOfMe: boolean;
}

/**
 * The single notification kind to emit for this post, or `null` for none.
 *
 * Returns the most specific applicable kind. Callers must emit exactly one
 * notification for the returned kind and none for the others.
 */
export function resolveReticulumNotificationKind(
  context: NotificationKindContext
): ReticulumNotificationKind | null {
  if (!context.isMessage || !context.isFromOther || !context.hasMyAddress) {
    return null;
  }
  if (context.isReplyToMe) return 'reply';
  if (context.isMentionOfMe) return 'mention';
  return 'message';
}

/**
 * True when a generic "someone posted" notification should be emitted.
 *
 * The generic kind is the fallback: it applies only when no more specific kind
 * does. Expressed as a separate predicate because that is the bug's shape —
 * the generic emitter needs to know about *every* higher kind, not just the
 * ones whose flag variables happen to be in scope.
 */
export function shouldEmitGenericMessageNotification(
  context: NotificationKindContext
): boolean {
  return resolveReticulumNotificationKind(context) === 'message';
}

/**
 * The kind to emit, given what the emitter *actually did* rather than what was
 * merely applicable.
 *
 * This mirrors the emitter in `Group.tsx` exactly, and exists because the
 * wiring there has now been wrong in both directions:
 *
 *   - Inferred "a mention happened" from flags assigned only inside the mention
 *     branch, so a skipped mention looked like no mention and the generic
 *     notification fired alongside the specific one (duplicates).
 *   - Set the "higher priority emitted" flag unconditionally after calling the
 *     mention recorder, which returns silently for a plain message, so ordinary
 *     posts lost their notification entirely.
 *
 * Both failures are invisible when the decision is spread across a 200-line
 * async callback. Here it is one pure function with both directions tested.
 */
export function resolveEmittedNotificationKind(params: {
  /** A reply notification was actually emitted. */
  replyEmitted: boolean;
  /** A mention notification was actually emitted. */
  mentionEmitted: boolean;
  /**
   * Mentions are suppressed for this post — e.g. a welcome post with welcome
   * notifications disabled. Suppression also suppresses the generic fallback:
   * the user asked not to be notified about this class of post at all.
   */
  suppressMention: boolean;
}): ReticulumNotificationKind | null {
  if (params.replyEmitted) return 'reply';
  if (params.mentionEmitted) return 'mention';
  if (params.suppressMention) return null;
  return 'message';
}
