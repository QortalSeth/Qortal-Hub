import jsSHA from 'jssha';

export function compareGroupCallElectionDigests(
  aDigest: string,
  bDigest: string
): number {
  const left = aDigest.trim();
  const right = bDigest.trim();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Deterministic SHA-256 hex of `address:roomId[:callSessionId]` (UTF-8).
 * Matches `crypto.createHash('sha256').update(s, 'utf8').digest('hex')` in the
 * main process (`group-call` chooseMainTopologyAuthority) so renderer and
 * Electron agree.
 *
 * P-7: when `callSessionId` is supplied it acts as an unpredictable per-call
 * salt, so an attacker can no longer grind an address offline to win the fixed
 * `sha256(address + ':' + roomId)` election. Callers on CALL_PROTOCOL_VERSION
 * >= 2 must always pass it; omitting it keeps the legacy digest for old peers.
 */
export function syncRootElectionDigestHex(
  rootAddress: string,
  roomId: string,
  callSessionId?: string
): string {
  const salt = callSessionId?.trim() ?? '';
  const input = salt
    ? `${rootAddress.trim()}:${roomId.trim()}:${salt}`
    : `${rootAddress.trim()}:${roomId.trim()}`;
  const shaObj = new jsSHA('SHA-256', 'TEXT', { encoding: 'UTF8' });
  shaObj.update(input);
  return shaObj.getHash('HEX');
}

/**
 * Tie-break two root candidates at the same topology epoch when `lastSeen` ties
 * or is missing: lower digest wins (same rule as main-process GC_TOPOLOGY authority).
 */
export function compareRootForwardersSameEpoch(
  incomingRoot: string,
  currentRoot: string,
  roomId: string
): number {
  const di = syncRootElectionDigestHex(incomingRoot, roomId);
  const dc = syncRootElectionDigestHex(currentRoot, roomId);
  return compareGroupCallElectionDigests(di, dc);
}

export function compareGroupCallElectionAddresses(
  a: string,
  b: string,
  electionDigests: ReadonlyMap<string, string>
): number | null {
  const aDigest = electionDigests.get(a)?.trim() ?? '';
  const bDigest = electionDigests.get(b)?.trim() ?? '';
  if (!aDigest || !bDigest) return null;
  return compareGroupCallElectionDigests(aDigest, bDigest);
}
