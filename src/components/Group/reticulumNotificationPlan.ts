/**
 * Decides which notifications a single Reticulum group post should emit.
 *
 * This exists because the same decision, implemented inline in
 * `processReticulumBackgroundEvent`, has been wrong three times in a row:
 *
 *   1. The generic notification's guard inferred "a mention was notified" from
 *      `authorizedBroadcast` / `directMention`, which were assigned only inside
 *      the mention branch. A skipped mention therefore looked identical to no
 *      mention, and the generic notification fired alongside the specific one —
 *      two notifications for one post.
 *   2. Setting the flag unconditionally after calling the mention recorder fixed
 *      the duplicate but suppressed the generic notification for *every* plain
 *      post, because that recorder returns silently when the reader is not in
 *      the mentioned-address list.
 *   3. Rewriting a comment above the flag declarations deleted
 *      `replyNotificationEmitted` while leaving three references to it, which
 *      threw `ReferenceError` at runtime.
 *
 * Each failure was invisible because the logic lived inside a 200-line async
 * callback in a 6k-line component, with no test able to reach it. The decision
 * is now a plain function over injected dependencies: the async lookups are
 * parameters, so the whole sequence is deterministic and testable.
 *
 * Invariant: at most one of `reply` / `mention` / `message` is true.
 */

export type ReticulumNotificationKind = 'reply' | 'mention' | 'message';

export interface NotificationPlanInput {
  /** The post is a message (not an edit, delete, reaction, or metadata event). */
  isMessage: boolean;
  /** The post was authored by someone other than the reader. */
  isFromOther: boolean;
  /** The reader's own address is known. */
  hasMyAddress: boolean;
  /**
   * `eventType === 'message' && !skipReplyNotification`.
   *
   * Distinct from `isMessage`: the reply branch additionally requires that the
   * caller has not suppressed reply lookups (history replay does).
   */
  replyLookupAllowed: boolean;
  /**
   * The event this post replies to, or `undefined` when it is not a reply.
   *
   * A single value rather than a boolean plus a separate id: having both let
   * them disagree, which is how the reply branch became unreachable in the
   * first version of this function.
   */
  repliedToEventId?: string;
  /**
   * Whether mention notifications are recorded at all for this post. False for
   * history replay, which must not replay old mentions as notifications.
   */
  recordMentionNotification: boolean;
  /** A welcome post with welcome-post notifications disabled. */
  isWelcomePost: boolean;
  /** The group's `notifyOnWelcomePosts` setting. */
  notifyOnWelcomePosts: boolean;
}

export interface NotificationPlanDeps {
  /** Author address of the message this post replies to, or `null` if unknown. */
  lookupReplyParentAuthor: (repliedToEventId: string) => Promise<string | null>;
  /** Replies ↔ settings: `notifyOnReplies` for this channel. */
  getNotifyOnReplies: () => Promise<boolean>;
  /** Whether the channel is muted for this reader. */
  isChannelMuted: () => Promise<boolean>;
  /** `authorizedReticulumBroadcastApplies(event)` — an `@everyone`-style broadcast. */
  isAuthorizedBroadcast: () => boolean;
  /** `event.directMentionAuthorized === true` — a mention the reader may receive. */
  isDirectMention: () => boolean;
  /** The reader's own address. */
  myAddress: string;
}

export interface NotificationPlan {
  /** Emit a reply notification. */
  reply: boolean;
  /** Emit a mention notification. */
  mention: boolean;
  /** Emit the generic "posted in channel" notification. */
  message: boolean;
  /**
   * The single kind to emit, or `null` for none. Derived from the three
   * booleans above; present so callers cannot accidentally emit two.
   */
  kind: ReticulumNotificationKind | null;
  /** True when a welcome post had mention notifications suppressed. */
  suppressMention: boolean;
  /** Broadcast/mention flags, returned because the caller reuses them. */
  authorizedBroadcast: boolean;
  directMention: boolean;
}

const EMPTY_PLAN: NotificationPlan = {
  reply: false,
  mention: false,
  message: false,
  kind: null,
  suppressMention: false,
  authorizedBroadcast: false,
  directMention: false,
};

/**
 * Resolve the emission plan for one post.
 *
 * Ordering is reply → mention → message, most specific first. The first
 * applicable kind wins and the rest are suppressed, so a post that replies *and*
 * mentions emits exactly one reply notification.
 */
export async function planReticulumNotifications(
  input: NotificationPlanInput,
  deps: NotificationPlanDeps
): Promise<NotificationPlan> {
  if (!input.isMessage || !input.isFromOther || !input.hasMyAddress) {
    return EMPTY_PLAN;
  }

  // ---- reply -------------------------------------------------------------
  let reply = false;
  const repliedToEventId = String(input.repliedToEventId || '').trim();
  if (input.replyLookupAllowed && repliedToEventId) {
    try {
      const parentAuthor = await deps.lookupReplyParentAuthor(repliedToEventId);
      if (parentAuthor && parentAuthor === deps.myAddress) {
        const notifyOnReplies = await deps.getNotifyOnReplies();
        if (notifyOnReplies) {
          const muted = await deps.isChannelMuted();
          if (!muted) reply = true;
        }
      }
    } catch {
      // Parent lookup failed — skip the reply notification, as before.
    }
  }

  // ---- welcome-post suppression -----------------------------------------
  const suppressMention =
    input.isWelcomePost && input.notifyOnWelcomePosts === false;

  // ---- mention -----------------------------------------------------------
  let mention = false;
  let authorizedBroadcast = false;
  let directMention = false;
  if (
    !reply &&
    input.recordMentionNotification &&
    !suppressMention &&
    input.isMessage
  ) {
    authorizedBroadcast = deps.isAuthorizedBroadcast();
    directMention = deps.isDirectMention();
    // A mention notification is emitted only when the reader is the one
    // mentioned. This is the condition the recorder itself checks, so the plan
    // and the recorder cannot disagree.
    mention = authorizedBroadcast || directMention;
  }

  // ---- generic message ---------------------------------------------------
  // The fallback: only when nothing more specific applies, and never for a post
  // the reader authored, nor for a broadcast/mention that already notified.
  const message =
    !reply &&
    !mention &&
    !suppressMention &&
    input.recordMentionNotification &&
    input.isMessage &&
    !authorizedBroadcast &&
    !directMention;

  const kind: ReticulumNotificationKind | null = reply
    ? 'reply'
    : mention
      ? 'mention'
      : message
        ? 'message'
        : null;

  return {
    reply,
    mention,
    message,
    kind,
    suppressMention,
    authorizedBroadcast,
    directMention,
  };
}
