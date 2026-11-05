# Hub calls: other devices keep ringing after the call is answered

**Date:** 20 October 2026
**Checked against:** `Qortal-Hub` `develop` at `ae338f34` (5 Oct 2026). `v3.0.3` has the same code.
**Severity:** medium. Not a security issue.

## What happens

Someone is signed in to the same account on two devices, for example a desktop Hub and a phone. A call comes in and rings on both. They answer on one device. The other device should stop ringing, and Hub already has code for that (`cancelOtherRingingEndpoints`). There are two cases where it doesn't work, and the other device keeps ringing until its own 60 s timeout.

## 1. The cancellation is rejected if the call is answered after 30 s

**Where**

- The caller's renderer pre-signs the cancellation `CALL_HANGUP` when it sends the request. It uses the **request** timestamp (`src/hooks/useVoiceCall.ts:3582-3597`: `const cancellationTimestamp = timestamp;`).
- After `CALL_ACCEPT`, `cancelOtherRingingEndpoints` sends that pre-signed hangup to the callee's other devices (`electron/src/call.ts:1889` and `:2597-2622`).
- Receivers reject any `CALL_*` signature more than 30 s old (`electron/src/ed25519-verify-common.ts:212`: `if (skew > 30_000 || skew < -10_000) return false;`).

**Effect.** If the callee answers more than 30 s after the call started, the other devices drop the cancellation as "invalid signature" and keep ringing.

**Suggested fix.** When `call:accepted` fires, have the caller's renderer sign a fresh `CALL_HANGUP` (current timestamp) and send that. Another option is to pre-sign two or three cancellations with later timestamps (for example +25 s and +50 s) and send the newest one that is still inside the window.

**Compatibility.** A fresh signature verifies on every 3.0.x receiver. Nothing changes on the wire.

## 2. The cancellation only goes to devices the caller knew about at the start

**Where**

- `invitedReticulumPeerHashes` is filled once, from the presence routes the caller had for the callee when the call started (`electron/src/call.ts:1487-1509`). A device that later sends `CALL_REJECT` is added (`:1941-1943`). Nothing else is added.
- `cancelOtherRingingEndpoints` sends only to that set (`:2607-2620`).
- The `CALL_REQUEST` itself also goes out by overlay flood, so it can reach callee devices that are **not** in the caller's presence routes.

**Effect.** A callee device reached only through the overlay rings, but it never gets the cancellation. It keeps ringing until its 60 s timeout. This follows from the code; we have not caught it in a log yet.

**Suggested fix.** At accept time, send the cancellation to the callee's current presence routes as well as the invited set. If `CALL_HANGUP` can travel the overlay the same way `CALL_REQUEST` does, flood it as well, with the request's `X`, so devices only reachable that way are covered too.

**Compatibility.** No new message type. It is the same `CALL_HANGUP`, sent to more destinations.

## Also worth thinking about

Today only the **caller** can stop the callee's other devices. If the caller's app is closed or offline at the moment of accept, nothing stops them. A small "answered on another device" message, signed by the callee's own key and sent only to that account's own other devices, would cover this, because each device can check that the signer is its own address. That would be a new message type, so older Hubs would just ignore it and fall back to the 60 s timeout.
