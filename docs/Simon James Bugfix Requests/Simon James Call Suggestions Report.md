# Simon James call suggestions — implementation report

Status of all 36 items in
[`0 - hub-calls-suggestions-for-hub-devs-2026-10-18.md`](0%20-%20hub-calls-suggestions-for-hub-devs-2026-10-18.md).

Work landed across three OpenSpec changes, all archived on 2026-10-20:
`call-security-hardening`, `call-privacy-stun-overhaul`, and
`call-bugs-and-cleanup`. Three items plus one partial are still open and are
written up at the end.

## Table of contents

**Security**

- [S-1](#s-1) — signature cache forgery (critical)
- [S-2](#s-2) — unsigned `GA` "call full" DoS
- [S-3](#s-3) — hop limit, unbounded maps, relay-before-verify
- [S-4](#s-4) — audio link identity overwritten by a claim
- [S-5](#s-5) — room key never rotated on leave
- [S-6](#s-6) — decrypted audio mutates the roster
- [S-7](#s-7) — topology/leave fields outside the signature

**Privacy**

- [P-1](#p-1) — host and public candidates, no IP policy
- [P-2](#p-2) — 1:1 signalling flooded as readable JSON
- [P-3](#p-3) — group/DM join frames flooded, **DM room id reversible** — _not applied_
- [P-4](#p-4) — no "Reticulum only" setting
- [P-5](#p-5) — no TURN or user ICE servers
- [P-6](#p-6) — STUN contribution on by default
- [P-7](#p-7) — fixed public election hash
- [P-8](#p-8) — Opus VBR and the audio-level extmap

**Bugs**

- [B-1](#b-1) — readiness gate blocks calls
- [B-2](#b-2) — unanswered calls never end
- [B-3](#b-3) — member allowlist frozen at join — _partially applied_
- [B-4](#b-4) — DataChannel sends while ICE is down
- [B-5](#b-5) — CALL_REQUEST sent once
- [B-6](#b-6) — busy callee silently ignores
- [B-7](#b-7) — CALL_REJECT has no fallback
- [B-8](#b-8) — multi-device cancellation expires
- [B-9](#b-9) — non-canonical link drops control frames
- [B-10](#b-10) — link-auth over a lossy packet — _not applied_
- [B-11](#b-11) — inconsistent signature windows
- [B-12](#b-12) — bare `instanceof SharedArrayBuffer`
- [B-13](#b-13) — hard-coded English
- [B-14](#b-14) — dead code and drift
- [B-15](#b-15) — community STUN announce rate limits

**Suggestions**

- [X-1](#x-1) — capability resent forever
- [X-2](#x-2) — forwarder hint
- [X-3](#x-3) — ringing acknowledgement
- [X-4](#x-4) — calling a lapsed-presence account
- [X-5](#x-5) — call lane and slim diagnostics

**Not applied**

- [P-3 — salted DM voice room ids](#not-applied-p-3)
- [B-10 — link-auth over the reliable channel](#not-applied-b-10)
- [B-3 — event-driven member refresh](#not-applied-b-3)

---

## Security

<a id="s-1"></a>

### S-1. The verified-signature cache is keyed by signature only

**Applied.** The cache is still used for `GC_KEY`, `GC_KEY_REQUEST` and
`GC_RTC_SIGNAL`, where a hit means "already processed, drop it". For
`GC_JOIN`, `GC_JOIN_RK`, link-auth join, `GC_LEAVE`, `GC_TOPOLOGY` and cluster
heartbeats, `enqueueVerify` now falls through to a full Ed25519 verify instead
of returning early on a hit ([`group-call.ts:2824`](../../electron/src/group-call.ts)).
The signature-only cache key is unchanged, so a forged frame cannot reuse a
cached "verified" verdict.

**Reasoning.** Dropping the cache outright was the audit's suggestion. Keeping
it for the three types where it only provides deduplication preserves the
cheap path without reintroducing the forgery, and the verify cost (~0.1 ms) is
irrelevant for join/leave/topology volume.

<a id="s-2"></a>

### S-2. Unsigned `GA` activity frames can stop anyone from joining

**Applied.** `shouldRejectLocalJoinAtParticipantCap` now enforces the cap only
against the verified `room.participants` map. When no room exists the spectator
count is ignored rather than trusted
([`group-call.ts:4478`](../../electron/src/group-call.ts)). The live-call badge
is gated on having seen at least one verified `GC_JOIN`.

**Reasoning.** `GA` is unsigned by design — it exists so non-members can show a
live-call badge. Letting unsigned data make an admission decision was the bug;
the fix is to narrow what it is authoritative for, not to sign it.

<a id="s-3"></a>

### S-3. Hop limit, unbounded maps, relay-before-verify

**Applied.** Four sub-fixes:

1. `L` is clamped on receive in both managers.
2. The seen-id maps are bounded at 8192 with oldest-first eviction
   ([`call.ts:2563`](../../electron/src/call.ts), [`group-call.ts:4157`](../../electron/src/group-call.ts)).
3. The pre-join room buffer is capped.
4. A relay checks `deriveAddressFromPublicKey(k) === a` before forwarding.

**Reasoning.** All four are amplification or memory-exhaustion vectors on a path
any overlay participant can reach. None changes the wire format, so no version
gate was needed.

<a id="s-4"></a>

### S-4. An audio link's peer identity is overwritten by a self-claimed hash

**Applied.** Once a link is identified, `peerPresenceHash` is latched. An
explicit `authenticatedPeerHash` is passed to Electron for link-bound checks
([`group-call.ts:12052`](../../electron/src/group-call.ts)), and an expired
link-auth join is no longer accepted merely because it matches a self-claimed
destination hash.

**Reasoning.** Accepting the claimed hash let a peer impersonate another
participant on a link it did not control. The bridge already knows which link
was authenticated, so the fix was to use that knowledge rather than the frame's
claim.

<a id="s-5"></a>

### S-5. The group room key is never rotated when someone leaves

**Applied.** On a verified leave, the root mints a fresh key, increments
`mediaSessionGeneration` and redistributes
([`groupCallAudioEngineRuntime.ts:5951`](../../src/lib/group-call/groupCallAudioEngineRuntime.ts)).

**Reasoning.** Without rotation a departed participant kept the key and could
decrypt all subsequent audio. Peers already adopt a higher generation from the
authoritative root, so the rotation needed no new wire message.

<a id="s-6"></a>

### S-6. Decrypted audio adds roster entries and clears tombstones

**Applied.** Only addresses already present in the verified participant roster
are noted as active, and decoding media no longer clears a leave tombstone.

**Reasoning.** Media arrives after decryption, which means anyone holding the
room key could previously resurrect a removed participant by simply sending
audio. Roster authority belongs to verified join/leave frames.

<a id="s-7"></a>

### S-7. Topology and leave fields outside the signature

**Applied.** `clusters` is added to the `GC_TOPOLOGY` signed field set, `j` to
`GC_LEAVE`, and `GC_TOPOLOGY` gained the same clock window as other frames.

**Reasoning.** A relay could rewrite the cluster assignment on an otherwise
valid frame. Signing the fields closes that without changing the message type,
so old peers still parse the frame — they simply verify a larger field set.
This rode the protocol version bump because the signed set changed.

---

## Privacy

<a id="p-1"></a>

### P-1. WebRTC sends every host and public candidate

**Applied.** A shared [`candidateFilter.ts`](../../src/lib/call/candidateFilter.ts)
drops `typ host` candidates, non-public addresses (private, CGNAT, loopback,
link-local, IPv6 ULA, reserved, mDNS `.local`, unparseable), and IPv6 srflx
candidates; it strips `raddr`/`rport`. It is wired into all three transports
([`directVoiceWebRtcTransport.ts`](../../src/lib/call/directVoiceWebRtcTransport.ts),
[`directScreenShareWebRtcTransport.ts`](../../src/lib/call/directScreenShareWebRtcTransport.ts),
[`groupCallWebRtcDataChannelTransport.ts`](../../src/lib/group-call/groupCallWebRtcDataChannelTransport.ts)).
The audio-surface window runs with
`setWebRTCIPHandlingPolicy('default_public_interface_only')`
([`setup.ts:904`](../../electron/src/setup.ts)).

**Reasoning.** A host candidate hands the peer your LAN address; a private
address in signalling is a direct network-identity leak. Only a relay candidate
may legitimately be IPv6, since there is no NAT to hide behind.

<a id="p-2"></a>

### P-2. 1:1 call signalling flooded as readable JSON

**Applied.** After the overlay flood, `initiateCall` sends the same signed wire
pinned to each known callee route with `L: 0`, so relays never re-forward it.
Dedup by `callId`/`X` means the callee rings once. The flood is retained.

**Reasoning.** The audit suggested demoting the flood once pinned delivery was
proven. A transport-level send succeeding does not prove the receiver decoded
it, and some peers are only reachable through the overlay, so demoting it would
trade a privacy gain for a reachability regression. The pinned copy already
removes the need for relays to see the traffic.

<a id="p-3"></a>

### P-3. Group and DM-voice join/leave frames flooded; DM room id reversible

**Partially applied.** GJ/GL are now delivered directly to the room roster and
member allowlist, falling back to flood
([`group-call.ts:4322`](../../electron/src/group-call.ts)).

**Not applied:** salted DM voice room ids. See
[Not applied — P-3](#not-applied-p-3).

<a id="p-4"></a>

### P-4. No "Reticulum only" setting

**Applied.** `callReticulumOnly` is a persisted setting with a toggle in call
settings. A runtime flag in [`callNetworkPreference.ts`](../../src/lib/call/callNetworkPreference.ts)
is mirrored from settings, and when set no capability is advertised or
acknowledged and no RTC signal is sent
([`groupCallAudioEngineRuntime.ts:121`](../../src/lib/group-call/groupCallAudioEngineRuntime.ts)).

**Reasoning.** A compile-time switch meant the privacy property was not
user-controllable. A runtime flag keeps the shell and the hidden audio-surface
window in agreement.

<a id="p-5"></a>

### P-5. No relay (TURN) or user-defined ICE server option

**Applied.** Data model, persistence, merge, UI and the transport policy are all
present:

- `callCustomIceServers` and `callIceRelayOnly` persist in `AppSettings`.
- `setCustomIceConfiguration` merges user servers ahead of the community pool.
- `getIceServersForRenderer()` returns full `RTCIceServer` objects, so TURN
  credentials survive the IPC hop. This was a real bug: the group runtime
  rebuilt each entry as `{ urls }`, silently dropping the credentials.
- `getIceTransportPolicy()` is exposed over IPC and applied at all three
  `RTCPeerConnection` construction sites.
- A settings panel in [`HomeProfileCard.tsx`](../../src/components/Group/HomeProfileCard.tsx)
  provides URL/username/credential rows and the relay toggle.

**Reasoning.** Chromium cannot change `iceTransportPolicy` on a live
connection, so it has to be resolved before construction. Server rows are
stored as full objects rather than a URL projection because a type that strips
credentials lets a future consumer drop TURN auth without any test failing.

<a id="p-6"></a>

### P-6. Community STUN contribution is on by default

**Applied.** The default is `false` ([`setup.ts:1844`](../../electron/src/setup.ts)).
Only an explicit stored `true` enables contribution, so existing contributors
keep working while a fresh install announces nothing.

**Reasoning.** Contribution binds a UDP port, maps it through UPnP and
publishes the router's public IP. That requires consent, so the migration is
"keep an explicit yes", not "prompt or migrate silently".

<a id="p-7"></a>

### P-7. Group root election is a fixed public hash

**Applied.** The election digest is salted with the per-call `callSessionId`
([`election-order.ts:25`](../../src/lib/group-call/election-order.ts)).

**Reasoning.** A predictable digest let a stranger in an open group grind
addresses until they sorted first and became root — and the root sees every
participant's traffic. The session id is unpredictable before the call and is
already distributed by the join flow.

<a id="p-8"></a>

### P-8. Opus VBR without padding, plus the RTP audio-level header

**Applied.** `bitrateMode: 'constant'` in the WebCodecs encoder
([`configureWebCodecsOpusEncoderForGcall.ts:26`](../../src/lib/group-call/configureWebCodecsOpusEncoderForGcall.ts))
and the sender engine ([`groupCallAudioSenderEngine.ts:710`](../../src/lib/group-call/groupCallAudioSenderEngine.ts)).
`hardenOpusSdp` adds `cbr=1` to every Opus fmtp line and strips the
`ssrc-audio-level` extmap ([`candidateFilter.ts:249`](../../src/lib/call/candidateFilter.ts)).

**Reasoning.** VBR packet sizes track speech activity, so an observer of
ciphertext length can infer who is talking without decrypting anything. The
audio-level header leaks the same signal in the clear on the native RTP path.

---

## Bugs

<a id="b-1"></a>

### B-1. The call readiness gate blocks calls for 15 s and above 65% CPU

**Applied.** Only `status === 'blocked'` prevents a call
([`useVoiceCall.ts:437`](../../src/hooks/useVoiceCall.ts)). `warning` shows a
non-blocking hint, and an `unknown` snapshot triggers a fresh reading.

**Reasoning.** The first 15 seconds after startup always reported `unknown`, so
every early call was refused for no reason. A high CPU reading is a quality
signal, not a hard stop.

<a id="b-2"></a>

### B-2. Unanswered calls never end in the UI

**Applied.** Both 60 s timers emit `call:hangup` with `reason: 'timeout'`
([`call.ts:1573`](../../electron/src/call.ts)), the outbound path sends the
pre-signed cancellation first, and the renderer leaves the calling state on it.

**Reasoning.** Nothing reached the renderer when the timer fired, so the UI
rang forever. Sending the cancellation before deleting the record is what stops
the callee's other devices as well.

<a id="b-3"></a>

### B-3. The group member allowlist is frozen at join time

**Partially applied.** `startMemberGateRefresh` re-fetches `getGroupMembers`
every 60 s while a call is active and re-pushes the addresses
([`groupCallAudioEngineRuntime.ts:9670`](../../src/lib/group-call/groupCallAudioEngineRuntime.ts)),
cleared at all four teardown sites. The event-driven half is wired but has no
trigger. See [Not applied — B-3](#not-applied-b-3).

<a id="b-4"></a>

### B-4. The group DataChannel keeps sending while ICE is disconnected

**Applied.** `send()` returns `false` when
`connectionState !== 'connected'` ([`groupCallWebRtcDataChannelTransport.ts:168`](../../src/lib/group-call/groupCallWebRtcDataChannelTransport.ts)),
and the buffer threshold dropped from 256 KB to 32 KB (~0.5 s of audio).

**Reasoning.** Reporting success while ICE was down hid the failure from the
per-packet fallback, so audio went into a black hole instead of switching to
Reticulum. A smaller buffer bounds how much stale audio can accumulate.

<a id="b-5"></a>

### B-5. CALL_REQUEST is sent once, by overlay flood only

**Applied.** Pinned sending plus a 4 s re-flood with a fresh dedup id for the
ring window ([`call.ts:1237`](../../electron/src/call.ts)), cleared when the
call leaves `pending` and when ringing is acknowledged.

**Reasoning.** One lost flood meant a permanently unanswered call on lossy mesh
paths and phones waking from Doze. Receivers dedupe by `callId`, so repeats are
safe.

<a id="b-6"></a>

### B-6. A busy callee silently ignores a second incoming call

**Applied.** The callee auto-rejects with `'busy'` when its state is not idle
([`useVoiceCall.ts:3391`](../../src/hooks/useVoiceCall.ts)), and the caller maps
it to a localized message.

**Reasoning.** Silence left the caller ringing for the full timeout with no
idea what happened.

<a id="b-7"></a>

### B-7. CALL_REJECT has no overlay fallback

**Applied.** After the pinned pair, the rejection is also flooded through
`sendEnvelope` ([`call.ts:1358`](../../electron/src/call.ts)).

**Reasoning.** The pinned path only reaches endpoints whose link can be
admitted; if the caller's inbound limit was full, the decline was never
delivered and — with B-2 — the caller rang until timeout.

<a id="b-8"></a>

### B-8. Multi-device cancellation stops working after 30 s

**Applied.** Cancellation is now signed fresh and sent to the callee's other
devices rather than reusing the request-time signature
([`call.ts:2415`](../../electron/src/call.ts)). The window was also widened by
B-11.

**Reasoning.** A pre-signed cancellation only verified while
`now - timestamp <= skew`, so an answer after 30 s silently failed to stop the
account's other devices. Signing at accept time removes the dependency.

<a id="b-9"></a>

### B-9. Python drops reliable control frames on a "non-canonical" link

**Applied.** `QGCCTL1` frames are never dropped on canonical grounds, and
[`_audio_link_pick_keep`](../../electron/resources/presence_bridge.py) now
decides by established state, then presence hash + direction, with activity
only as a tie-break.

**Reasoning.** The old rule preferred whichever link had more _local_ activity.
Each end measures its own, so both ends could prefer their own link and
disagree — control frames then arrived on the "wrong" one and were discarded.
The new ordering compares facts both ends compute identically.

<a id="b-10"></a>

### B-10. Link-auth is sent once as a lossy packet

**Partially applied.** Link-auth is resent every 2 s up to 5 times until the
peer shows acceptance, and `QGCCTL1` is exempt from the 320 ms media deadline
in the bridge.

**Not applied:** sending link-auth/GK/GQ over the Channel once GCC1 is
acknowledged, and the 16-frame control buffer. See
[Not applied — B-10](#not-applied-b-10).

<a id="b-11"></a>

### B-11. Signature time windows are tight and differ by message type

**Applied.** `MAX_CALL_CLOCK_SKEW_MS = 60_000` is the single window for call
frames ([`ed25519-verify-common.ts:16`](../../electron/src/ed25519-verify-common.ts)),
and a frame dropped for skew logs a "check your clock" warning
([`:31`](../../electron/src/ed25519-verify-common.ts)).

**Reasoning.** Per-type windows meant the same frame could pass one check and
fail another, and 30 s was shorter than the 60 s ring window — so a legitimate
late answer failed to cancel other devices (B-8).

<a id="b-12"></a>

### B-12. `capture-processor.js` uses a bare `instanceof SharedArrayBuffer`

**Applied.** The check is guarded with `typeof SharedArrayBuffer !==
'undefined'` ([`capture-processor.js:99`](../../public/worklets/capture-processor.js)).

**Reasoning.** A bare `instanceof` against an undefined global throws a
`ReferenceError` in any environment without cross-origin isolation, which
killed capture entirely instead of degrading.

<a id="b-13"></a>

### B-13. Hard-coded English in the call UI

**Applied.** `core:voice_call.*` now carries 60 keys. The remaining user-facing
strings in `useVoiceCall.ts` and the three call components are keyed,
including the new ringing, may-be-asleep, and screen-share messages. English
only; the other locales keep their previous four `voice_call` keys pending a
translation pass.

**Reasoning.** The earlier pass covered the `i18n.t` call sites but left the
diagnostic-reason paths (`showGlobalCallSnack`, `showHint`) in English, which is
exactly the category users actually see.

<a id="b-14"></a>

### B-14. Dead code, docs drift and type drift

**Applied.** `useGroupVoiceCall.ts`, `DirectVoiceCallDock.tsx` and
`QortalGroupVoiceCallDock.tsx` are deleted; `handleRtcWire` and the
`call:rtc-signal` forwarding are gone; `CALL_RTC_SIGNAL` is removed from the
signing policy; `docs/group-audio-calls.md` is updated and the
`AudioSurfaceEvent` type drift is fixed.

<a id="b-15"></a>

### B-15. Community STUN discovery runs on rate-limited announces

**Applied.** The full rework:

- Contributor announce cadence 120 s → 3600 s, lease 48 min, discovery query
  floor 5 s → 10 min ([`stun-coordinator.ts:54`](../../electron/src/stun-coordinator.ts)).
- Endpoint lists are served from a request handler on a **separate**
  `community-stun-query` destination with its own rotating identity.
- Query answers are packets, not endpoint re-announces, so they spend no
  announce budget.
- Query announces are throttled to one per 10 minutes inside the bridge,
  independently of the coordinator's floor.
- A cache-less client asks a known contributor directly when announces yield
  nothing; contributor hashes stay inside the bridge and are never exposed to
  the renderer.
- Endpoint adverts continue, less often, for receivers that only understand
  announces.

**Reasoning.** Transport nodes apply a per-destination announce target of 3600 s
by default, and queries, answers and adverts all shared one budget per
destination hash. Throttling the coordinator alone was not enough because the
bridge re-announced on every request. New coverage:
`CommunityStunDiscoveryB15Test` (5 tests).

---

## Suggestions

<a id="x-1"></a>

### X-1. Capability is resent every 12 s forever

**Applied.** Exponential backoff 12 s → 24 s → 48 s → 60 s cap, stopping after
10 unanswered capabilities per peer and resetting when a capability arrives
([`groupCallAudioEngineRuntime.ts:914`](../../src/lib/group-call/groupCallAudioEngineRuntime.ts)).

**Reasoning.** A peer that never answers is either gone or incompatible;
retrying every 12 s for the whole call spends Reticulum bandwidth for nothing.

<a id="x-2"></a>

### X-2. Optional "don't make me forwarder" hint

**Applied.** A `callDontForward` setting with a toggle, a runtime flag, and a
passthrough into the join wire as an **unsigned** `fwd: 0` field. Election skips
hinted peers while another eligible peer remains, and still elects them when
they are the only candidate.

**Reasoning.** Phones are elected root about 1/N of the time, and Android may
freeze a backgrounded app, so a phone root is a bad outcome even when the
digest picks it. The field must stay outside the signed set: peers on the
previous protocol rebuild that set and would fail verification.

<a id="x-3"></a>

### X-3. Optional ringing acknowledgement

**Applied.** `CALL_RINGING` (`CG`) is added end to end. The callee sends one when
its ringer fires; the caller switches its status to "Ringing…" via a new
`stage: 'ringing'` and a `ringingAcknowledged` flag, leaving `CallState`
untouched. The CALL_REQUEST re-flood stops on the acknowledgement
([`call.ts:2325`](../../electron/src/call.ts)).

**Reasoning.** `CallState` already uses `'ringing'` for the _callee's_ incoming
state, and nine branches gate on `callState === 'calling'`; reusing it for the
caller would have silently changed all of them. The audit asked for the flood
to stop once the callee is reached — an acknowledgement is proof of delivery,
so further floods only spend overlay budget.

<a id="x-4"></a>

### X-4. Allow calling an account whose presence has lapsed

**Applied.** A bounded (24 h) last-known-destination fallback, a
`CallInitiateFailure` out-parameter carrying `no_route` vs `lapsed_presence`, a
`lapsed_presence` hangup reason, and localized "may be asleep" text.

**Reasoning.** A phone that slept had no live presence route, so the caller was
told the account was unreachable when it was merely asleep. The distinction has
to be a reason code end to end; inferring it from a log string in the UI would
break the moment the string changed.

<a id="x-5"></a>

### X-5. Separate call lane and slimmer diagnostics

**Applied.** `_scheduler_lane_for_command` returns `'call-send'` for call
frames, so a chat burst cannot delay call signalling past its window. The
periodic `group_audio_queue_state` payload is now slim, and the complete block
is available on explicit request through `get_full_audio_queue_diagnostics`.

**Reasoning.** Call frames share a 20–30 s validity window; sitting behind a
chat burst silently drops them. The diagnostics block shipped the full
per-interface RNS timing data twice a second for as long as any audio link was
busy, which costs real main-process time when nobody is investigating.

---

## Not applied

Two items could not be applied safely and one has a missing trigger. All three
are tracked in `openspec/changes/call-followups/` and recorded here with the
blocker and the recommended resolution.

<a id="not-applied-p-3"></a>

### P-3 — salted DM voice room ids

**Status:** not applied. The group half of P-3 shipped.

#### The problem remains

`buildDmVoiceRoomId` hashes the direct chat id, which is a pure function of the
two wallet addresses:

```ts
// src/lib/call/directVoiceReticulumMedia.ts:23
const digest = await sha256Hex(directChatId);
return `${DM_VOICE_ROOM_PREFIX}${digest.slice(0, DM_VOICE_ROOM_ID_DIGEST_HEX_LEN)}`;
```

A join frame carries `{ a: <caller>, R: "dmv:<18 hex>" }`. Any relaying Hub can
recover the callee offline by testing every known address pair — a dictionary
lookup over the address set, not a hash inversion.

#### Why it was not applied

The settled derivation needs an X25519 shared secret from the local wallet key.
**The renderer never holds that key.** Renderer signing posts to the background
worker, which calls `getKeyPair()` and wipes the private bytes in a `finally`
block. The only Curve25519 secret derivation in that worker is
`decryptBoxWithMyKey`, and it is not exposed to the renderer.

Separately, `gcall:join` takes `roomId` as its **first positional argument** in
a tuple documented as order-critical, and the room id is already committed
before the join on both paths. Deriving after the call request reorders the
accept path rather than adding a function.

#### Recommended resolution

1. Add a `deriveDmVoiceRoomIdV2` background case taking
   `{ peerEd25519PublicKeyBase58, callId }`. Derive with
   `ed2curve.convertSecretKey` + `nacl.box.before`, hash, return, wipe in
   `finally` — the same shape as `decryptBoxWithMyKey`. The salt never leaves
   the worker.
2. Resolve the peer's public key before calling join on both paths. On the
   callee this is free (the request carries a verified `fromPublicKey`); on the
   caller, move the derivation to just before the join.
3. Gate on `CALL_PROTOCOL_VERSION >= 2`. A 3.0.x peer computes the old id, so
   shipping unilaterally would silently split rooms.

The salt must be the shared secret **plus** the `callId`. The call id alone is
readable by relays; the shared secret alone is stable per pair, so the room id
would become a linkable identifier in a different shape.

<a id="not-applied-b-10"></a>

### B-10 — link-auth, GK and GQ over the reliable channel

**Status:** partially applied. Resend-until-accepted and the media-deadline
exemption shipped; the channel switch and the 16-frame buffer did not.

#### Why it was not applied

The remaining half needs to know when GCC1 is acknowledged. **The TypeScript
side cannot observe that.** `GCC1` exists only in
`electron/resources/presence_bridge.py`; `grep GCC1 electron/src/*.ts` returns
nothing, so `GroupCallManager` has no signal to key the switch off, and the
control buffer is gated on the same condition.

#### Recommended resolution

1. Have the bridge emit `group_audio_control_channel_ready`, keyed by link.
2. Consume it in `GroupCallManager` beside the existing link-auth state
   machine, flipping a per-link `channelReady` flag.
3. Gate both the channel send path and the 16-frame buffer on that flag.

Both are local; no wire change, so no protocol-version gate.

<a id="not-applied-b-3"></a>

### B-3 — event-driven member refresh

**Status:** partially applied. The 60 s timer shipped, and so did the fan-out
plumbing; the trigger is missing.

#### What exists

The audio-surface channel has a `refresh-member-gate` command
([`audioSurfaceBridge.ts`](../../src/lib/group-call/audioSurfaceBridge.ts)) and
the runtime re-arms `startMemberGateRefresh` when it arrives, so the hidden
window can be told to refresh from the main shell.

#### Why the trigger is missing

**The main shell has no group membership event stream.**

- The only group socket is `ChatGroup.tsx` →
  `/websockets/chat/messages?txGroupId=…`, which carries chat messages, not
  membership changes.
- `WebsocketNotifications.tsx` subscribes to `/websockets/notifications` but
  only for `PAYMENT_RECEIVED`, `RESOURCE_PUBLISHED` and Q-Chat types.
- `useQortalMessageListener.tsx` lists `BAN_FROM_GROUP` / `CANCEL_GROUP_BAN`
  as outbound _request_ names, not inbound events.

Qortal Core does publish membership events, but the exact names and payload
shape could not be verified offline, and guessing them would ship a listener
that never fires.

#### Recommended resolution

Confirm Core's membership event names, subscribe to them, and send:

```ts
window.audioSurface.sendCommand({ type: 'refresh-member-gate', groupId });
```

The 60 s timer already bounds staleness, so this is a latency optimisation, not
a correctness fix.
