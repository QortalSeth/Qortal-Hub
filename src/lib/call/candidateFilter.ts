/**
 * P-1: WebRTC candidate / SDP filtering.
 *
 * Calling peers must not learn our LAN addresses, VPN adapter addresses or
 * global IPv6 addresses. Chromium stops masking host candidates behind mDNS
 * names once the page holds microphone permission, so filtering has to happen
 * in our code, before the candidate or SDP is signed and sent.
 *
 * This module is transport-agnostic: the same helpers wrap the DM voice,
 * screen-share and group DataChannel `RTCPeerConnection` instances.
 */

/**
 * Whether an address may be handed to a remote peer.
 *
 * Kept addresses are public unicast IPv4 and global-scope IPv6. Everything
 * private, loopback, link-local, CGNAT, ULA, multicast or unparseable is
 * dropped.
 */
export function isPublicUnicastAddress(raw: string | null | undefined): boolean {
  const address = (raw ?? '').trim().toLowerCase();
  if (!address) return false;

  // mDNS placeholder names are never routable.
  if (address.endsWith('.local')) return false;

  const version = address.includes(':') ? 6 : 4;

  if (version === 4) {
    const octets = address.split('.');
    if (octets.length !== 4) return false;
    if (!octets.every((part) => port4Octet(part))) return false;
    const [a, b] = octets.map((part) => Number(part));
    // 0.0.0.0/8 (unspecified / "this network")
    if (a === 0) return false;
    // 10.0.0.0/8 private
    if (a === 10) return false;
    // 127.0.0.0/8 loopback
    if (a === 127) return false;
    // 169.254.0.0/16 link-local
    if (a === 169 && b === 254) return false;
    // 172.16.0.0/12 private
    if (a === 172 && b >= 16 && b <= 31) return false;
    // 192.168.0.0/16 private
    if (a === 192 && b === 168) return false;
    // 100.64.0.0/10 CGNAT
    if (a === 100 && b >= 64 && b <= 127) return false;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 documentation
    if (a === 192 && b === 0 && octets[2] === '2') return false;
    if (a === 198 && b === 51 && octets[2] === '100') return false;
    if (a === 203 && b === 0 && octets[2] === '113') return false;
    // 198.18.0.0/15 benchmarking
    if (a === 198 && (b === 18 || b === 19)) return false;
    // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved
    if (a >= 224) return false;
    return true;
  }

  // IPv6. Only global unicast (2000::/3) is acceptable.
  const firstHextet = address.split(':')[0] ?? '';
  if (!firstHextet) return false;
  // Reject IPv4-mapped / IPv4-compatible forms (::ffff:a.b.c.d, ::a.b.c.d).
  if (address.startsWith('::')) return false;
  // fe80::/10 link-local
  if (/^fe[89ab]/.test(firstHextet)) return false;
  // fc00::/7 unique-local
  if (/^f[cd]/.test(firstHextet)) return false;
  // ff00::/8 multicast
  if (/^ff/.test(firstHextet)) return false;
  // 2000::/3 global unicast covers everything we allow.
  const numeric = parseInt(firstHextet.replace(/[^0-9a-f]/g, '') || '0', 16);
  if (!Number.isFinite(numeric)) return false;
  return numeric >= 0x2000 && numeric <= 0x3fff;
}

function port4Octet(part: string): boolean {
  if (!/^\d{1,3}$/.test(part)) return false;
  const value = Number(part);
  return value >= 0 && value <= 255;
}

/**
 * P-1: decide whether a locally gathered candidate may be signalled.
 *
 * Host candidates are always dropped: they are the LAN address by definition.
 * Server-reflexive and relay candidates are kept only when their address is
 * public, and their `raddr`/`rport` (the peer's view of our own socket, which
 * on a srflx candidate carries the LAN address) is blanked.
 *
 * Returns `null` when the candidate must not be sent.
 */
export function filterIceCandidate(
  candidate: RTCIceCandidate | RTCIceCandidateInit
): RTCIceCandidateInit | null {
  const init: RTCIceCandidateInit =
    typeof (candidate as RTCIceCandidate).toJSON === 'function'
      ? (candidate as RTCIceCandidate).toJSON()
      : { ...(candidate as RTCIceCandidateInit) };

  // `type` is present on toJSON(); older/bare inits only carry the raw string.
  const declaredType = String(init.type ?? '');
  const parsed = parseCandidateLine(init.candidate ?? '');

  const type = declaredType || parsed.type;

  // Host candidates never leave the machine directly.
  if (type === 'host') return null;

  // Drop anything we can positively identify as a private address. When no
  // address is present (bare/legacy init) there is nothing to leak, so keep it
  // and let the SDP filter handle the default connection address.
  const address = (init.address || parsed.address || '').trim();
  if (address && !isPublicUnicastAddress(address)) return null;

  // Blank the related address even when it parses as public: on a srflx
  // candidate `raddr` is our LAN address as seen by the STUN server.
  if (init.relatedAddress || parsed.raddr) {
    init.relatedAddress = '0.0.0.0';
    init.relatedPort = 0;
  }

  if (init.candidate) {
    init.candidate = scrubCandidateLine(init.candidate);
  }

  return init;
}

interface ParsedCandidateLine {
  foundation?: string;
  component?: string;
  protocol?: string;
  priority?: string;
  address?: string;
  port?: string;
  type?: string;
  raddr?: string;
  rport?: string;
  rest: string[];
}

function parseCandidateLine(line: string): ParsedCandidateLine {
  const trimmed = line.trim();
  const withoutPrefix = trimmed.startsWith('candidate:')
    ? trimmed.slice('candidate:'.length)
    : trimmed;
  const parts = withoutPrefix.split(/\s+/);
  return {
    foundation: parts[0],
    component: parts[1],
    protocol: parts[2],
    priority: parts[3],
    address: parts[4],
    port: parts[5],
    type: parts[7],
    raddr: parts[9],
    rport: parts[11],
    rest: parts.slice(12),
  };
}

/**
 * Rebuild an `a=candidate` line with `raddr`/`rport` zeroed, preserving every
 * other extension attribute (`generation`, `ufrag`, `network-id`, …).
 */
function scrubCandidateLine(line: string): string {
  const hasPrefix = line.trim().startsWith('candidate:');
  const parsed = parseCandidateLine(line);
  if (!parsed.address || parsed.type === 'host') return line;

  const tokens = [
    parsed.foundation,
    parsed.component,
    parsed.protocol,
    parsed.priority,
    parsed.address,
    parsed.port,
    'typ',
    parsed.type,
  ];
  if (parsed.raddr) {
    tokens.push('raddr', '0.0.0.0', 'rport', '0');
  }
  tokens.push(...parsed.rest);
  return `${hasPrefix ? 'candidate:' : ''}${tokens.join(' ')}`;
}

/**
 * P-1: strip `a=candidate` lines we would never signal, and neutralise a
 * default connection address (`c=`) or RTCP address (`a=rtcp:`) that points at
 * a private interface.
 *
 * Until STUN answers, Chromium's default `c=` is the host address, so leaving
 * it untouched would leak the LAN address even with every candidate filtered.
 */
export function filterLocalSdp(sdp: string): string {
  if (!sdp) return sdp;
  const lines = sdp.split(/\r?\n/);
  const keptCandidates: string[] = [];
  const output: string[] = [];

  for (const line of lines) {
    if (line.startsWith('a=candidate:')) {
      const parsed = parseCandidateLine(line.slice(2));
      const address = (parsed.address ?? '').trim();
      const type = parsed.type ?? '';
      if (type === 'host') continue;
      if (address && !isPublicUnicastAddress(address)) continue;
      const scrubbed = scrubCandidateLine(line.slice(2));
      keptCandidates.push(scrubbed);
      output.push(`a=${scrubbed}`);
      continue;
    }
    output.push(line);
  }

  const keptAddresses = new Set(
    keptCandidates
      .map((line) => parseCandidateLine(line).address ?? '')
      .filter(Boolean)
  );

  return output
    .map((line) => {
      if (line.startsWith('c=')) {
        const address = line.slice(2).split('/')[0]?.trim() ?? '';
        if (!isPublicUnicastAddress(address) && !keptAddresses.has(address)) {
          return 'c=IN IP4 0.0.0.0';
        }
        return line;
      }
      if (line.startsWith('a=rtcp:')) {
        const address = line.slice('a=rtcp:'.length).split(' ')[0]?.trim() ?? '';
        const host = address.split(':')[0] ?? '';
        if (host && !isPublicUnicastAddress(host) && !keptAddresses.has(host)) {
          const port = address.split(':')[1] ?? '9';
          return `a=rtcp:${port} IN IP4 0.0.0.0`;
        }
        return line;
      }
      return line;
    })
    .join('\r\n');
}

/**
 * P-8: constant-bitrate Opus and no cleartext audio-level header.
 *
 * - adds `cbr=1` to every Opus `a=fmtp` line, so packet size no longer tracks
 *   speech and cannot be used to tell who is talking;
 * - removes the `urn:ietf:params:rtp-hdrext:ssrc-audio-level` extmap (SRTP
 *   leaves that header extension unencrypted), unless a transport-wide-cc
 *   extension shares the same id.
 */
export function hardenOpusSdp(sdp: string): string {
  if (!sdp) return sdp;
  const lines = sdp.split(/\r?\n/);
  const audioLevelExtIds = new Set<string>();
  for (const line of lines) {
    const match = /^a=extmap:(\d+)\s+\S*ssrc-audio-level/i.exec(line);
    if (match) audioLevelExtIds.add(match[1]!);
  }
  const output: string[] = [];
  for (const line of lines) {
    if (
      audioLevelExtIds.size > 0 &&
      /^a=extmap:\d+/.test(line) &&
      /ssrc-audio-level/i.test(line)
    ) {
      continue;
    }
    if (line.startsWith('a=fmtp:')) {
      const isOpus = /opus\/48000/i.test(line) || /a=rtpmap:\d+ opus/i.test(sdp);
      if (isOpus && !/(^|;)cbr=/.test(line)) {
        output.push(`${line};cbr=1`);
        continue;
      }
    }
    output.push(line);
  }
  return output.join('\r\n');
}

/**
 * P-1 + P-8: prepare a local SDP for a peer.
 *
 * Strips private candidates and private default addresses (P-1), then hardens
 * Opus: constant bitrate and no cleartext audio-level header (P-8).
 */
export function blankPrivateDefaultAddress<T extends { sdp?: string }>(
  description: T | null | undefined
): T | null | undefined {
  if (!description?.sdp) return description;
  return {
    ...description,
    sdp: hardenOpusSdp(filterLocalSdp(description.sdp)),
  };
}
