# Qortal Hub: chat sync and chat engine bugs (2026-10-19)

Hi Hub team,

We maintain Qortal GO, an Android fork of Qortal Hub. It shares Hub's chat engine (`electron/src/reticulum-chat.ts` and `reticulum-chat-db.ts`), with a few GO-only changes on top. GO users reported slow Q-Chat sync and channels that never load. While we looked into that, we found the bugs below. All of them are in upstream Hub code, and all of them also affect desktop Hubs. We left out everything that only affects our phone setup.

**Refs checked** (fetched from GitHub on 2026-10-19):

- tag `v3.0.3` @ `f3b75daa`, the newest 3.0.x tag;
- `develop` @ `ae338f34` (2026-10-05).

**Line numbers are the same in both refs:**

- `reticulum-chat.ts` is byte-identical.
- `reticulum-chat-db.ts` differs by one unrelated line (13630).
- Every `Group.tsx` line we cite comes before its only change (line 3565).

**How we tested.** We ran small scratch vitest files against a `git archive` of each ref, with the sources unmodified.

- SQLite is real: Node 22's built-in `node:sqlite` behind a thin better-sqlite3-compatible wrapper, because the repo's better-sqlite3 binary is built for Electron.
- Test #2 uses upstream's own better-sqlite3 test mock.
- Every test gave the same result on `v3.0.3` and `develop`.
- Timings come from one x86-64 desktop with files on tmpfs, so treat them as lower bounds.
- We're happy to share the test files.

## Summary

- **Search index (#1):** every stored message and every expired message deletes from the FTS table by an unindexed column, which is a full scan. At 100k indexed messages, one expiry pass over 500 messages blocks the chat engine for 12-13 s.
- **Local notify round trip (#2, #10):** a Hub emits every imported event to its own UI twice. It keeps one notify file per stored event until restart, and its UI re-indexes every message twice. The in-memory event map also grows for the life of the process and is scanned once per group on every summaries refresh.
- **Author-gap repair (#3, #4):** deleted and expired messages leave sequence holes that no node can fill, and the repair loop never gives up on them. In a simulated network, one such hole cost 44-80 futile resource links a day.
- **Channel metadata (#5-#9):**
  - a failed admin-list fetch silently drops an admin's own channel edits;
  - a snapshot from a former admin puts the honest relay on cooldown for every group;
  - admins re-request a stored full snapshot every minute, forever;
  - deferred metadata retries every 30 s, forever;
  - channels made by former admins differ between old and new nodes.
- **Logging (#11):** a `dm_notify` that is only stale is logged as `bad_signature_or_shape`.

| #   | Issue                                                                                         | Severity                       | Area             |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------ | ---------------- |
| 1   | FTS delete by `event_id` is a full table scan, on every insert and every expired message      | Medium (high on big databases) | Chat DB          |
| 2   | Each imported event reaches the Hub's own UI twice; notify files pile up until restart        | Medium                         | Chat engine / UI |
| 3   | Deleted and expired messages leave sequence holes no node can fill                            | Medium                         | Group sync       |
| 4   | Author-gap repair never gives up on a range nobody can serve                                  | Medium                         | Group sync       |
| 5   | A failed admin-list fetch marks the user non-admin everywhere; skipped edits stay lost        | Medium (admins)                | Channels         |
| 6   | A snapshot signed by a former admin counts as a violation by the relay, for all groups        | Medium                         | Channels         |
| 7   | An admin re-requests a full snapshot it already applied, every minute, forever                | Low-medium                     | Channels         |
| 8   | Unprojectable channel metadata retries every 30 s forever, with a Core check each time        | Low                            | Channels         |
| 9   | Channels made by former admins stay on old nodes, never show on new ones, and can't be edited | Low-medium (needs a decision)  | Channels         |
| 10  | In-memory event map is unbounded and scanned once per group on every summaries refresh        | Low                            | Chat DB          |
| 11  | A stale `dm_notify` is logged as `bad_signature_or_shape`                                     | Low                            | Diagnostics      |

How they interact:

- #2 multiplies #1, because each duplicate event triggers another UI re-index, and each re-index runs the scan.
- #3 creates the holes that #4 keeps retrying.
- #6 and #7 make snapshots fragile, yet snapshots are the only way a channel from #9 reaches a new node.

Unless a path says otherwise, it is relative to `electron/src/`. "rc" means `reticulum-chat.ts` and "db" means `reticulum-chat-db.ts`.

---

## 1. The search index delete is a full table scan, on every stored message and every expired message

**Severity:** medium, and high on Hubs with large chat databases. The engine's SQLite calls run synchronously in the Electron main process (`startReticulumChatManager`, rc:43628-43660, called from `setup.ts:2742` in v3.0.3 and `:2925` on develop). So a slow statement stalls the chat engine and its IPC to the UI.

**Where** (v3.0.3 and develop)

- **The table:** db:12796-12805 creates `reticulum_chat_search_fts` as FTS5 with `event_id UNINDEXED`.
- **The statement:** db:2346-2348, `stmtDeleteSearchText` = `DELETE FROM reticulum_chat_search_fts WHERE event_id = ?`.
- **When it runs:**
  - Every new message: `insertEvent` → `refreshMessageProjectionIndexes` (db:5034, 6569-6608) → `upsertProjectedSearchText` (db:6538-6567), which deletes at 6545. It runs even though a new message has no FTS row yet.
  - Every UI re-index: `indexSearchText` (db:6610-6617) takes the same path. `Group.tsx` calls it for every message event (see #2).
  - Every expired message:
    - `pruneExpiredMessages` (db:4298-4400) runs the delete once per thread event (4378), and once more for the root (4386).
    - A pass runs at most once a minute (db:103, 4402-4406), and handles up to 5,000 roots.
    - It is triggered from `insertEvent` (db:4934) and from several read paths (db:6716, 6978, 7213, 7346, 7490, 7565).
  - Also `deleteSearchText` (db:6619-6625), `deleteCachedEvent` (db:5949-5957) and the delete scrub (db:5520).

**What users see**

- Chat gets slower as the search index grows.
- Sometimes many messages expire at once:
  - the first pass after the Hub was closed for a day;
  - an admin shortens a channel's expiry;
  - qortal-land (1-day expiry) in busy groups.
- Then the chat engine blocks for seconds.

**Why it happens**

- FTS5 can only find rows by rowid or by `MATCH`. A `WHERE` on an `UNINDEXED` column reads every row.
- `EXPLAIN QUERY PLAN` shows `SCAN reticulum_chat_search_fts VIRTUAL TABLE INDEX 0:`.
- The mirror table `reticulum_chat_search_index` (db:12785-12795) has `event_id TEXT PRIMARY KEY`, so a fast key exists, but the FTS delete doesn't use it.

**Proof**

(a) The upstream DDL and delete statement on real SQLite, 200 deletes of ids that are not in the table (the new-message case):

| Indexed rows | Delete by `event_id` | Delete by rowid |
| ------------ | -------------------- | --------------- |
| 1,000        | 0.10 ms              | 0.001 ms        |
| 10,000       | 0.96 ms              | 0.001 ms        |
| 50,000       | 5.4 ms               | 0.001 ms        |
| 100,000      | 11.3 ms              | 0.001 ms        |

(b) Unmodified `ReticulumChatDatabase`. We filled the FTS table, inserted 500 qortal-land messages that expire a minute later, then measured one normal `insertEvent` and one `pruneExpiredMessages` pass. The ranges cover the v3.0.3 and develop runs.

| FTS rows | One `insertEvent` | One prune pass (500 expired roots) |
| -------- | ----------------- | ---------------------------------- |
| 500      | 2.2-4.0 ms        | 47-75 ms                           |
| 10,500   | 3.3-6.9 ms        | 1.1-1.8 s                          |
| 50,500   | 7.8-9.3 ms        | 5.8-7.0 s                          |
| 100,500  | 13.7-15.3 ms      | 11.8-13.3 s                        |

**Suggested fix**

1. **Delete by rowid.** Give each FTS row the rowid of its mirror row.
   - The mirror's rowid is stable, because its upsert is `ON CONFLICT(event_id) DO UPDATE`.
   - Insert with an explicit `rowid` taken from the mirror row.
   - Delete with `DELETE FROM reticulum_chat_search_fts WHERE rowid = ? AND event_id = ?`, using the mirror rowid looked up by `event_id` before the mirror row is removed.
   - The extra `AND event_id = ?` is free after the rowid lookup. It guarantees that a stale rowid (for example, a row written by an older Hub after a downgrade) can never delete another message's row.
   - Run a one-time local rebuild: delete all FTS rows, then copy them back from the mirror with matching rowids. Both tables hold the same normalized text today.
2. **Cheap interim fix, no schema change.** Skip the FTS delete when the mirror has no row for that id. That check is a primary-key lookup. It removes the scan from the new-message path, which is the most common case.
3. In `pruneExpiredMessages`, delete the batch's FTS rows once per pass, not once per event.

**Compatibility**

- Local storage only. Nothing changes on the wire.
- The FTS columns stay the same, and older code still deletes by `event_id`, so a downgrade keeps working.

---

## 2. Every imported event reaches the Hub's own UI twice, and one notify file per event stays on disk until restart

**Severity:** medium. Every message costs extra CPU and IPC. A directory that grows with uptime is read every 2 s.

**Where**

- **Writing:**
  - rc:26844: `storeValidatedEvent` writes a notify file for every stored event (`writeLocalEventNotification`, rc:28266-28287).
  - The file name is **not** added to `seenLocalNotifyFiles`.
  - The calendar writer (rc:28289-28309) does add its own file name, with the comment "The file exists only to wake other managers sharing the database."
- **Reading:**
  - rc:28182-28203: `scanLocalNotifications` reads the whole directory every 2 s (rc:28140-28142) and after every `fs.watch` event (rc:28146). It handles every file it hasn't seen yet.
  - rc:28205-28264: `handleLocalNotificationFile` then calls `emitSummaryChanged` and `emitGroupEventIfVisible` (rc:28258-28259).
- **The first emit already happened.** The import paths emit the event themselves:
  - rc:39102-39118 (history pages);
  - rc:23699-23711 (event batches);
  - rc:39567-39577 (single-event resources).
- **Cleanup never runs during a session:**
  - rc:28311-28325: `cleanupOldLocalNotifications` deletes files older than 10 min.
  - It runs only from `startLocalNotificationWatcher` (rc:28111), which returns early while the watcher is running (rc:28109).
  - The watcher stops only when no group is subscribed (rc:12165-12166) or on close.
- **The UI handles the duplicate as new work** (`src/components/Group/Group.tsx`):
  - :2720: the renderer skips an already-processed event unless `recordMentionNotification === true`.
  - :2818-2820: the live `onEvent` listener always passes `true`.
  - So the second copy is re-indexed again: `indexSearchText` (:2770) and `replaceMentions` (:2778). That is two more IPC calls, and each runs the scan from #1.

**Why it happens**

- The notify directory exists so that a short-lived second manager on the same DB (`applyReticulumChatChannelMetadataInDb`, rc:43617-43626) can wake the main one.
- But the main manager also reads back its own files.
- Own posts depend on this today. `publishEvent` (rc:12202, accept at rc:12267) never emits `event` itself, so an own post reaches the UI only through its notify file.

**What users see**

- Nothing looks broken.
- The cost per imported event:
  - 2× `event` IPC;
  - 2× `summaryChanged`;
  - 2 UI re-index round trips.
- The notify directory grows by one file per stored event for the whole uptime.
- The 2-second directory read grows with it.

**Proof**

- **Double emit.** One manager, the normal desktop setup. We stored 50 events with the same two calls the page import makes (`acceptEvent`, then `emitGroupEventIfVisible`), then waited 2.5 s:
  `{"events":50,"eventEmitsTotal":100,"minPerEvent":2,"maxPerEvent":2,"summaryChangedTotal":100,"notifyFilesLeft":50,"seenSetSize":50}`
- **Directory read cost** (`readdirSync` plus the `Set` check, as in `scanLocalNotifications`), on tmpfs:

  | Files   | ms per scan |
  | ------- | ----------- |
  | 1,000   | 0.3         |
  | 10,000  | 3.4         |
  | 50,000  | 27          |
  | 100,000 | 55          |

  Real disks, and NTFS especially, are slower.

**Suggested fix**

1. In `writeLocalEventNotification`, add the file name to `seenLocalNotifyFiles`, as the calendar writer does.
2. Emit own published events directly once `acceptEvent` succeeds in `publishEvent`, so own posts no longer depend on the file round trip.
3. Clean up during the session. For example, once a minute, delete notify files older than 10 min and drop their names from `seenLocalNotifyFiles`.
4. In `Group.tsx`, for an already-processed event, only record the mention notification if it isn't recorded yet. Skip `indexSearchText` and `replaceMentions`: the engine already indexes on insert (db:5034).

**Compatibility**

- Local only. Nothing changes on the wire.
- Files from other managers are still read, so the second-manager wake-up keeps working.

---

## 3. Deleted and expired messages leave sequence holes that no node can fill

**Severity:** medium. No message is lost, but every node that missed a deleted or expired message keeps a permanent repair target for it, and #4 retries it forever.

**Where**

- **Serving leaves them out:**
  - db:2476-2487: `stmtGetAuthorEventsRange` filters `scrubbed_at IS NULL` and `RETICULUM_CHAT_VISIBLE_EVENT_SQL` (db:115-116: `expires_at` in the future).
  - `authorizeLinkedAuthorRangeResource` reads it (rc:41242-41253) and answers `no_history_events` when nothing is left.
- **Heads and gaps still count them:**
  - **Expired:** `pruneExpiredMessages` deletes the rows and writes `rchat_expired_event_markers` (db:4329-4389). An event that arrives already expired only gets a marker (db:4942-4958).
  - The head and gap queries all union those markers:
    - `stmtGetAuthorMaxSeq` (db:2051-2062);
    - `stmtGetAuthorHeads` (db:2069-2091);
    - `stmtGetAllAuthorSequenceHeads` (db:2092-2105);
    - `stmtGetAuthorSequenceGaps` (db:2106-2133);
    - `stmtGetGroupSeqs` (db:2141-2152).
  - `getAuthorMaxSeq` and `getSyncState` add the markers again (db:9772-9800, 10072-10110).
  - **Deleted:** a delete scrubs the target in place (`stmtUpdateScrubbedEvent`, db:2894-2903, via `scrubDeletedMessageThread`, db:5390). The row and its header stay, so the sequence number still counts. Edits of the deleted message are scrubbed too.
- **Holes become repair targets:**
  - `requestKnownAuthorGaps` (rc:24531-24575) turns `getAuthorSequenceGaps` holes into missing ranges.
  - So do author heads from peers, and a later sequence number arriving.
- **Missing ranges never age out:** `stmtDeleteMissingRange` (db:2767-2774) is used only when a range is filled (db:9584).

**Why it happens**

1. A node missed message N before it was deleted or expired.
2. It still learns that N exists: from a later sequence number by the same author, or from a peer head that counts N.
3. It records a missing range.
4. Every node that saw N now holds it only as a scrubbed row or an expired marker, and won't serve either.
5. Nothing on the wire says "N is gone", so the range can never close.

**What users see:** nothing in the UI. The logs repeat `author_gap_link_unavailable ... reason=no_history_events`, `author_gap_quarantined` and `author_gap_known_unavailable` for the same ranges (see #4).

**Proof** (unmodified `ReticulumChatDatabase`, real SQLite)

1. The provider stores sequence numbers 1-5 from one author:
   - 2 is a message;
   - 4 deletes it;
   - 3 is a qortal-land message that arrives 2 days old.
2. The requester stores 1, 4 and 5, so it missed 2 and 3.
3. Output:
   `{"providerInsertResults":[true,true,false,true,true],"providerHeadSeq":5,"providerServesRange2to3":[],"providerServesRange1to5":[5,4,1],"requesterGapRanges":[[2,3]]}`
4. The requester has a real hole at [2,3], and the provider answers it with nothing.

**Suggested fix**

1. **Local quorum, no wire change.** Count `no_history_events` answers from distinct providers per range, and persist the count.
   - After N distinct denials (the existing quorum is 3), record local "gone" markers for those sequence numbers, so gap discovery skips them and the missing range is dropped.
   - If an event inside the range ever arrives, clear the marker and import it.
   - A false "gone" only stops active asking; it never blocks import.
   - This is also the core of the #4 fix.
2. **Optional, later protocol addition.** A provider could say "I had these and they are gone", listing sequence numbers it holds only as scrubbed rows or expired markers. Today the reject carries only a reason string, and a new reason would be a route failure on older Hubs. So this needs a separate optional field behind a feature flag.

**Compatibility**

- Fix 1 changes only local bookkeeping.
- Fix 2 needs a capability flag. Older Hubs keep today's behaviour.

---

## 4. Author-gap repair never gives up on a range nobody can serve

**Severity:** medium. Each unfillable range (from #3, or history past the 30-day import limit) costs dozens of futile resource links a day. Every link also costs the provider a membership check and a DB read.

**Where**

1. **Backoff is per peer and in memory only:**
   - rc:7337-7340: `authorGapPeerAttempts` is a `Map`, cleared in `close()` (rc:8708).
   - rc:25224-25265: the next rung (30 s, 2 min, 10 min, 30 min, 2 h; rc:2592-2598) comes from the selected peer's in-memory count, not from the row.
   - db:9275-9328: `claimMissingRangeAttempt` keeps a lifetime `attempts` counter, but the backoff never uses it.
   - rc:23552-23571: after a denial, the row is rescheduled to `now` if any other eligible peer exists.
2. **A peer without the group's history can never deny, but it still counts:**
   - rc:41222-41225 (also rc:41095, 41624): a provider with no local history for the group answers `history_unavailable`.
   - rc:39770-39789: only `no_history_events` and `channel_read_forbidden` count as denials. Everything else is a route failure (rc:39790-39830).
   - rc:24809-24854: `getAuthorGapRepairCandidates` includes every subscribed peer.
   - rc:23505-23511: the quarantine threshold is `min(3, candidates)`.
3. **The 7-day park doesn't hold:**
   - rc:23535-23551: after ≥3 denials within 6 h and ≥12 attempts, the row gets a known-unavailable marker with a 7-day recheck (rc:2612-2616).
   - rc:24655-24686: an eligible peer that is not on the marker's list and reports the same range clears the marker and reschedules the row to `now`. The report can come from an author manifest, `requestKnownAuthorGaps` or an incoming event.
   - The marker's list holds only peers that denied in the last 6 h. Denials are pruned across all rows after 6 h (db:2672-2675, 8981).

**Why it happens**

- The loop is built so that one stale or dishonest provider can't hide history. That part is right.
- But nothing remembers that a range keeps failing across peers and restarts.
- So a range nobody can serve is retried at the rate peers come and go.

**What users see**

- Nothing in the UI.
- The logs repeat `author_gap_repair_ready`, `author_gap_link_unavailable reason=no_history_events`, `author_gap_quarantined` and `author_gap_known_unavailable` for the same ranges.
- `attempts=` keeps climbing while `next_retry_ms=30000` stays.
- Hubs also receive these futile requests as providers.

**Proof** (unmodified engine, real SQLite, simulated time; we stub the bridge send at `sendAuthorRangeRequest` and feed each peer's answer back through the real `handleEventPageResourceFailure`)

| Scenario                                                                                                             | Result                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| S1: 2 denying peers + 1 subscribed peer without the group's history, 6 h                                             | 0 quarantines. The peer without history was asked 7 times (`history_unavailable`); the two deniers once each.                   |
| S2: row already tried 12 times; 13 subscribed peers, all denying; one author manifest every 10 min                   | In one day the row was "parked for 7 days" 11 times. Each park was undone by the next manifest from a peer not yet on the list. |
| S4: restart after 8 h                                                                                                | 5 more links within 10 min, each back on the 30 s rung (`attempts=8..11 next_retry_ms=30000`).                                  |
| CHURN: one unfillable row; pool of 40 peers, 12 subscribed at a time, rotating every 15 min; a manifest every 10 min | 44, 77 and 80 links on days 1-3. The row was "parked for 7 days" 185 times in 3 days.                                           |

**Suggested fix** (all on the requesting side, no wire change)

1. **Persist a per-row denial count:** the number of distinct providers that answered `no_history_events` since the row last made progress.
   - Keep the immediate rotation for the first ~3 distinct deniers.
   - After that, back off the row itself, for example 1 h, 6 h, 24 h, then 7 d.
   - Store this in `next_attempt_at` so it survives restarts.
   - Don't base it on lifetime `attempts`. That counter also counts route and local failures, so a genuinely missing recent event would then wait for hours.
2. **Leave out peers without the group's history.** For about an hour after a peer answers `history_unavailable` for a group, don't select it for that group's ranges, and don't count it toward the threshold.
3. **Wake a parked row only on real new evidence:**
   - an event inside the range arrives;
   - the local user's access changes;
   - at most once a day, a provider not yet asked.

   When you re-park, keep the marker's peer list instead of rebuilding it from the last 6 h.

**Compatibility:** requester-side only. Providers simply get fewer requests. Older Hubs are unaffected.

---

## 5. A failed admin-list fetch makes the Hub treat the user as non-admin in every group, and the skipped channel edits stay lost for the session

**Severity:** medium for group admins.

**Where**

- **The UI turns a failed fetch into "admin nowhere"** (`src/components/Group/Group.tsx`):
  - :3036-3074 `getGroupsWhereIAmAMember`: on any error or non-OK answer from `/groups/member/{address}?adminOnly=true`, the catch sets the admin list to `[]`. It still marks the list as loaded for that address (:3060-3070).
  - :275-330: every membership pushed to the engine has `adminStatusAuthoritative: true` (:326), whether or not the list loaded.
  - :456-470: the next try comes 10 s later (5 min after a success).
- **The engine trusts it and skips the edits:**
  - rc:28014-28029 `getValidatedGroupAdminStatus`: for the user's own address it answers from that list, with no Core call (rc:28021-28028).
  - rc:26944-26972: a channel metadata event whose author is "not admin" is `skipped`.
- **Skips are final for the session:**
  - rc:27323-27348: a skipped event is added to `channelMetadataProjectionAttemptedIds` (rc:27340).
  - rc:27292: `queueChannelMetadataProjection` ignores attempted events.
  - rc:27299-27321: `queueChannelMetadataProjectionRepair` runs on group open and on membership re-init. It clears the flag only for `channel_create` events that are still unprojected (rc:27312).
  - So updates, archives, reorders and category events stay skipped until Hub restarts.
- **Side effects while the list is wrong:**
  - `localChannelReadPredicate` (rc:27229-27232) hides admin-only channels.
  - Each flip re-initializes every affected group (rc:8913-8944, 9047-9057).

**Why it happens:** "the admin list could not be loaded" is treated as "the user is admin nowhere", and marked authoritative. A node that is restarting, still syncing, or briefly unreachable is enough to trigger it.

**What users see**

- An admin renames, archives or reorders a channel, or edits a category, and the change doesn't apply. This also happens to the admin's own edits that arrive from another device while the list is empty.
- Admin-only channels disappear for a moment.
- Reopening the group doesn't bring the edits back; restarting Hub does.

**Proof**

1. The admin's own `channel_create` "news" is projected while the user is admin.
2. Memberships are pushed as `{isAdmin:false, adminStatusAuthoritative:true}`, which is what `Group.tsx` pushes after a failed fetch.
3. The admin renames the channel to "announcements" with their own `channel_update`.
4. Admin status is restored and the group is opened.

Output: `{"coreAdminChecksForOwnAddress":0,"nameAfterSkip":"news","nameAfterListFixed":"news","nameAfterGroupOpened":"news","stillMarkedAttempted":true}`.

Core would have said "admin", but it was never asked.

**Suggested fix**

1. In `getGroupsWhereIAmAMember`, keep the last good list for this address when a fetch fails, instead of `[]`. Add a timeout to the fetch.
2. Until the first success for an address, push `adminStatusAuthoritative: false`. The engine then asks Core about the own address, where "unknown" defers instead of skipping.
3. In the engine, remember skipped metadata events per (group, author). Re-queue them when that author becomes admin, either in `setLocalGroupMemberships` or on a fresh Core answer. Projection rebuilds are idempotent, so re-queuing is safe.

**Compatibility:** local only. Nothing changes on the wire.

---

## 6. A snapshot signed by a former admin counts as a protocol violation against the peer that relayed it

**Severity:** medium in groups whose admins change. One honest relay can be blocked from giving you any group's channel list for 5 minutes, again and again.

**Where**

- **Relays forward stale snapshots:**
  - rc:29695-29713 `getBestMetadataSnapshotForSend`: a node that can't build its own snapshot re-offers the newest one it has stored (rc:29711-29712).
  - It checks the signature, but not whether the signer is still an admin.
  - `getPublicMetadataSnapshotForSend` (rc:29562-29576) and `sendMetadataSnapshotToPeer` (rc:29578) offer it.
- **The receiver treats that as a violation:**
  - A snapshot with a valid signature, whose signer Core no longer lists as admin, leads to `notePeerViolation(peer, 'metadata_snapshot_non_admin')`.
  - Inline offers: rc:30188-30196, charged to the peer that sent the offer.
  - Resource downloads: rc:38786-38799, charged to the peer named as the snapshot's source.
- **The penalty covers every group:**
  - rc:26614-26628: every `metadata_snapshot_*` reason maps to the per-peer `metadata_offer` scope, not a per-group one.
  - rc:26656-26681, 2273-2274: 3 violations within 5 min start a 5-minute cooldown.
  - rc:18090: `handleWire` then drops every `metadata_snapshot_offer_v3` from that peer, for all groups.
- **The rejected hash isn't remembered,** so the next digest that advertises it can fetch it and reject it again.

**Why it happens:** being out of date is treated as misbehaving. The relay did nothing wrong: the snapshot was valid when the admin signed it, and relays pass on what they have.

**What users see**

- In groups where the admin set changed, channel lists from a given peer stop arriving for 5-minute stretches, for other groups too.
- The logs show `Peer protocol violation ... scope=metadata_offer reason=metadata_snapshot_non_admin count=3 cooldownMs=300000`.

**Proof**

1. An admin's Hub builds public snapshots for 4 groups.
2. On the receiving node, Core says the signer is no longer admin in 3 of them.
3. One relay offers the 3 stale snapshots, then the valid one for the 4th group.

Output: `{"violationLines":3,"lastViolation":"warn [ReticulumChat] Peer protocol violation peer=<relay> scope=metadata_offer reason=metadata_snapshot_non_admin count=3 cooldownMs=300000","relayCooledDown":true,"validSnapshotForOtherGroupReachedHandler":false,"otherGroupChannels":["general","qortal-land"]}`

**Suggested fix**

1. Don't call `notePeerViolation` for a snapshot with a valid signature whose signer only fails today's admin check. Keep the violation for bad signatures and malformed snapshots.
2. Remember `(groupId, snapshotHash)` as "signer not admin" for a while (for example 10 min, bounded). Skip that hash in the digest-driven request path and in the download queue.
3. Optional: in `getBestMetadataSnapshotForSend`, don't re-offer a stored snapshot whose signer Core no longer lists as admin.

**Compatibility**

- Local bookkeeping only. Nothing changes on the wire.
- Unfixed Hubs keep putting relays on cooldown, but fixed Hubs stop.

---

## 7. An admin keeps re-requesting a full snapshot it has already applied, once a minute per peer and group

**Severity:** low-medium. It loads both sides in the background, once a minute per (peer, group):

- the requester signs a request and runs a Core membership check;
- the peer serves the full snapshot again, as a resource when it has admin-only channels.

**Where**

- **An admin defers public snapshots:**
  - rc:29671-29684 `expectedMetadataSnapshotScope`: an admin expects a `full` snapshot.
  - rc:30155-30172: when an admin is offered a public snapshot, it defers it and requests a full one (by `fh`, or else `latest`).
- **The deferral never ends:**
  - rc:31162-31215 `deferMetadataSnapshot` retries after 5, 10, 20 and 40 s, then every 60 s, with no cap.
  - Each retry re-runs the offer handler, which defers and requests again.
- **Applying the full snapshot doesn't clear it:**
  - rc:30208-30212: when the full snapshot is applied, only deferrals for the applied hash are cleared.
  - `clearDeferredMetadataSnapshot` matches by hash (rc:31134-31150), so the deferred public entry stays.
- **Nothing stops the request:** rc:31217-31310 `requestMetadataSnapshotFromPeer` doesn't check whether the requested hash is already stored. Its debounce is 30 s (rc:2576).

**Proof**

1. An admin node gets a public offer with `fh`.
2. It requests the full snapshot and applies it. The snapshot is stored, and `ready` is `true`.
3. 10 minutes pass with no new offers.

Output: `{"fullStoredAfterApply":true,"ready":true,"requestsAtApply":1,"requestsAfter10Min":11,"hashesRequested":["the stored full hash"],"deferredEntriesLeft":1,"deferredAttempts":[13]}`.

It goes on until the Hub restarts or leaves the group.

**Suggested fix**

1. Once a full snapshot is stored for a group, drop all deferred public entries for that group. `clearDeferredMetadataSnapshotsForGroup` (rc:31152) already exists.
2. In `requestMetadataSnapshotFromPeer`, skip hashes that are already stored (`db.getMetadataSnapshotByHash`).
3. Cap the retries in `deferMetadataSnapshot`, for example at 4. The next digest hint can start over.

**Compatibility:** local. There are fewer requests on the wire, and no format change.

---

## 8. Channel metadata that can't be projected yet is retried every 30 s forever, with a fresh Core admin check each time

**Severity:** low. It is steady background load on the node, and it grows with the number of such events.

**Where**

- **When an event can't be projected:**
  - rc:27577: `rebuildChannelMetadataProjection` returns `deferred` when no admin-authored base exists for the channel. That happens when the `channel_create` is missing, is older than the 30-day import limit, or was made by a former admin (see #9).
  - rc:27550: it also returns `deferred` when any author in the channel's history has `unknown` admin status.
- **How it is retried:**
  - rc:27337-27342 hands it to `scheduleChannelMetadataProjectionRetry` (rc:27394-27414).
  - The retry interval is a fixed 30 s (rc:2639), with no cap and no backoff.
  - The admin cache TTL is also 30 s (rc:2636), so every retry asks Core again.

**Proof:** we gave a node a current admin's `channel_reorder` for a channel whose create it never received, then ran 10 simulated minutes. Output: `{"minutes":10,"retryLines":20,"adminValidatorCalls":21,"retryTimersPending":1}`.

**Suggested fix**

- Back off deferred retries: 30 s, 1 min, 5 min, 30 min, then hourly.
- Wake them when a `channel_create` for that channel is imported, or when a snapshot is applied for the group.
- For the "unknown author" case, keep the short retry only while Core is actually unavailable.

**Compatibility:** local.

---

## 9. A channel created by someone who is no longer admin stays on old nodes, never appears on new nodes, and can't be edited by current admins

**Severity:** low-medium. Members see different channel lists depending on how old their Hub's database is. This needs a decision on the intended rule.

**Where**

- rc:26944-26972 and 27551-27554: projection checks the author's admin status now (asking Core), not at the time of the event.
- **Old node:**
  - A skip never deletes an existing channel row. So a Hub that projected the channel while the creator was admin keeps it, even after a restart.
  - A current admin's later edit triggers a rebuild. The rebuild skips the create and ends `deferred` (rc:27577), which retries every 30 s (#8). The edit never applies.
- **New node:** it skips the same `channel_create` and never shows the channel from events.
- Only a current admin's snapshot can carry such a channel to new nodes, and #6 and #7 make that path fragile.

**Proof**

1. A node projects channel "projects", created by user X while X was admin.
2. X loses admin, and the node restarts.
3. A current admin moves the channel to position 3.
4. A fresh node receives the same signed `channel_create`.

Output: `{"oldNodeBefore":["general","projects","qortal-land"],"oldNodeAfterRestart":["general","projects","qortal-land"],"oldNodePositionAfterAdminMove":1,"oldNodeRetryTimers":1,"freshNode":["general","qortal-land"],"skippedLines":2}`

**Suggested fix** (pick one rule, and apply it on old and new nodes alike)

- **Option A:** a channel exists once a current admin vouches for it, through a signed snapshot or a later admin edit. Let the rebuild start from the stored row when that row's revision came from a verified snapshot, or treat a current admin's `channel_update` as adopting the channel.
- **Option B:** judge the creator by their admin status at the time of the event. This needs the group's admin history from Core.
- **Option C:** if removing former admins' channels is intended, old nodes should drop them on rebuild too, so all nodes agree.

**Compatibility:** projection is local, so nothing changes on the wire. Options A and C change what users see.

---

## 10. The in-memory event map grows for the life of the process, and every summaries refresh scans it once per group

**Severity:** low. The cost grows with uptime and traffic.

**Where**

- **The map only grows:**
  - db:1569: `memoryEvents`.
  - db:5022: every inserted event is added, payload included.
  - It is removed only on expiry prune (db:4372), scrub (db:5469) and `deleteCachedEvent` (db:5952). There is no size cap.
  - `memorySearchText` grows the same way.
- **The summaries path scans it:**
  - db:11277-11299: `getSummaryChannelIds` loops over the whole map (db:11293-11297).
  - `getChatSummaries` calls it once per group (db:11057).
- **The UI asks often:**
  - It requests summaries after every `summaryChanged`, debounced 150 ms with a 500 ms max wait (`src/components/Group/reticulumSummaryRefresh.ts:33-56`), and with no in-flight guard.
  - #2 doubles the `summaryChanged` events.
- 36 places in the DB class iterate the whole map (`memoryEvents.values()`).

**Proof:** we filled the map with same-shaped events for 60 groups and timed one summaries pass (`getSummaryChannelIds` for each group).

| Events in the map | One summaries pass |
| ----------------- | ------------------ |
| 10k               | 16-27 ms           |
| 50k               | 26-40 ms           |
| 100k              | 48-95 ms           |

**Suggested fix**

- The loop in `getSummaryChannelIds` looks redundant. An event enters `memoryEvents` only after its SQL insert succeeded (db:5022), so `stmtGetKnownChannels` already returns its channel. Drop the loop, or keep a per-group channel set instead.
- Bound `memoryEvents`, which the code calls a write-through cache and fallback (db:5416, 9761). For example, use an LRU with a cap, or evict an entry once its row is committed.

**Compatibility:** local.

---

## 11. A `dm_notify` that is only stale is logged as a bad signature

**Severity:** low; this is about diagnostics. It misleads anyone debugging DM delivery: clock skew or a slow path looks like a forged or broken wire.

**Where**

- rc:5802-5841: `reticulumDmNotifySignatureMaterial` returns `null` in three cases:
  - the wire is malformed;
  - `n` is more than 30 s in the future (rc:5819, 2171);
  - `n` is older than the 30 s TTL (rc:5820, 2765).
- rc:20474-20479: `handleDirectNotify` logs every `null` as `dm_notify_rejected ... reason=bad_signature_or_shape`.
- The real signature check comes later and has its own `bad_signature` line (rc:20532).

**Proof:** code reading. This line appears when a sender's clock is more than 30 s off, or when a notify waits more than 30 s anywhere on its way: relay hops, a busy main process, a laptop waking from sleep.

**Suggested fix:** have the material function return a reason (`stale`, `future` or `bad_shape`) and log that reason. Optionally, count stale drops separately.

**Compatibility:** log text only.

---

## Appendix: two short repros

**FTS scan (#1).** This uses plain `node:sqlite` on Node 22 with the exact upstream DDL:

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec(`CREATE VIRTUAL TABLE reticulum_chat_search_fts USING fts5(
  event_id UNINDEXED, group_id UNINDEXED, channel_id UNINDEXED, author_address UNINDEXED,
  timestamp UNINDEXED, event_type UNINDEXED, search_text, tokenize = 'unicode61');`);
console.log(
  db
    .prepare(
      'EXPLAIN QUERY PLAN DELETE FROM reticulum_chat_search_fts WHERE event_id = ?'
    )
    .all('x')
);
// -> [{ ..., detail: 'SCAN reticulum_chat_search_fts VIRTUAL TABLE INDEX 0:' }]
```

**Unfillable hole (#3).** This uses `ReticulumChatDatabase` from an unmodified checkout. `ev(seq, opts)` builds a signed event for one author in group 77 (`channelId`, `ts`, and `type: 'delete'` with `target`).

```ts
const provider = new ReticulumChatDatabase(tmpPath());
const s1 = ev(1),
  s2 = ev(2),
  s5 = ev(5);
const s3 = ev(3, { channelId: 'qortal-land', ts: Date.now() - 2 * DAY }); // arrives already expired
const s4 = ev(4, { type: 'delete', target: s2.eventId }); // deletes seq 2
[s1, s2, s3, s4, s5].forEach((e) => provider.insertEvent(e, false));
const requester = new ReticulumChatDatabase(tmpPath());
[s1, s4, s5].forEach((e) => requester.insertEvent(e, false)); // missed 2 and 3
requester.getAuthorSequenceGaps(77, 10); // -> one gap: 2..3
provider.getAuthorEventsRange(77, AUTHOR, STREAM, 2, 3, 101); // -> []
```

The other repros drive the real `ReticulumChatManager` with stubbed bridge sends and validators. We can send them over.
