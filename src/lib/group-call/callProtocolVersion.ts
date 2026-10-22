/**
 * Call protocol version.
 *
 * Bump this whenever the GC_JOIN / GC_LEAVE / GC_TOPOLOGY signed field sets,
 * the wire formats, or the root-election rule change in a way that peers must
 * agree on. Peers on different versions refuse to share a call room, so every
 * participant in a room is guaranteed to compute identical topology and
 * election results.
 *
 * Keep in sync with `CALL_PROTOCOL_VERSION` in `electron/src/group-call.ts`.
 *
 * History:
 * - 1: initial protocol (3.0.x)
 * - 2: signed `protocolVersion` on GC_JOIN, signed `clustersHash` on
 *      GC_TOPOLOGY, signed `joinGeneration` on GC_LEAVE, and a per-call
 *      `callSessionId` salt in the root-election digest (S-7, P-7).
 */
export const CALL_PROTOCOL_VERSION = 2;
