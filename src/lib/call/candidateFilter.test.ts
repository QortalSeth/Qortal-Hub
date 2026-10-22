import { describe, expect, it } from 'vitest';
import {
  blankPrivateDefaultAddress,
  filterIceCandidate,
  filterLocalSdp,
  hardenOpusSdp,
  isPublicUnicastAddress,
} from './candidateFilter';

const candidate = (
  address: string,
  type: string,
  extra: Partial<RTCIceCandidateInit> = {}
): RTCIceCandidateInit => ({
  candidate: `candidate:1 1 udp 2122260223 ${address} 54321 typ ${type} generation 0 ufrag abcd network-id 1`,
  address,
  port: 54321,
  type,
  ...extra,
});

describe('isPublicUnicastAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '203.0.114.5',
    '2001:4860:4860::8888',
    '2a00:1450:4001:81b::200e',
  ])('accepts public address %s', (address) => {
    expect(isPublicUnicastAddress(address)).toBe(true);
  });

  it.each([
    ['10.0.0.5', 'RFC1918 10/8'],
    ['172.16.4.9', 'RFC1918 172.16/12'],
    ['172.31.255.254', 'RFC1918 172.16/12 upper bound'],
    ['192.168.1.10', 'RFC1918 192.168/16'],
    ['100.64.1.2', 'CGNAT 100.64/10'],
    ['100.127.255.254', 'CGNAT upper bound'],
    ['127.0.0.1', 'loopback'],
    ['169.254.10.4', 'IPv4 link-local'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['fd00::1', 'IPv6 ULA'],
    ['fc00::abcd', 'IPv6 ULA prefix'],
    ['fe80::1', 'IPv6 link-local'],
    ['fe80::1234:5678', 'IPv6 link-local'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:8.8.8.8', 'IPv4-mapped'],
    ['ff02::1', 'IPv6 multicast'],
    ['abc.local', 'mDNS name'],
    ['', 'empty'],
    ['not-an-address', 'unparseable'],
    ['999.999.999.999', 'out-of-range IPv4'],
  ])('rejects %s (%s)', (address) => {
    expect(isPublicUnicastAddress(address)).toBe(false);
  });
});

describe('filterIceCandidate', () => {
  it('drops host candidates', () => {
    expect(filterIceCandidate(candidate('192.168.1.10', 'host'))).toBeNull();
    expect(filterIceCandidate(candidate('10.0.0.1', 'host'))).toBeNull();
    // Even a "public" host candidate never leaves the machine directly.
    expect(filterIceCandidate(candidate('8.8.8.8', 'host'))).toBeNull();
  });

  it('drops srflx candidates on private addresses', () => {
    expect(filterIceCandidate(candidate('192.168.0.5', 'srflx'))).toBeNull();
    expect(filterIceCandidate(candidate('10.1.2.3', 'srflx'))).toBeNull();
  });

  it('keeps a public srflx candidate but blanks raddr/rport', () => {
    const filtered = filterIceCandidate(
      candidate('203.0.114.5', 'srflx', {
        relatedAddress: '192.168.1.10',
        relatedPort: 54321,
      })
    );
    expect(filtered).not.toBeNull();
    expect(filtered!.relatedAddress).toBe('0.0.0.0');
    expect(filtered!.relatedPort).toBe(0);
  });

  it('scrubs raddr out of the raw candidate string', () => {
    const filtered = filterIceCandidate({
      candidate:
        'candidate:842163049 1 udp 1677729535 203.0.114.5 54321 typ srflx raddr 192.168.1.10 rport 54321 generation 0',
      address: '203.0.114.5',
      port: 54321,
      type: 'srflx',
    });
    expect(filtered!.candidate).toContain('raddr 0.0.0.0 rport 0');
    expect(filtered!.candidate).not.toContain('192.168.1.10');
  });

  it('keeps relay candidates on public addresses', () => {
    const filtered = filterIceCandidate(candidate('203.0.114.7', 'relay'));
    expect(filtered).not.toBeNull();
  });

  it('drops relay candidates on private addresses', () => {
    expect(filterIceCandidate(candidate('10.9.9.9', 'relay'))).toBeNull();
  });
});

describe('filterLocalSdp', () => {
  const sdp = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 192.168.1.10',
    'a=rtcp:9 IN IP4 192.168.1.10',
    'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host generation 0',
    'a=candidate:2 1 udp 1677729535 203.0.114.5 54322 typ srflx raddr 192.168.1.10 rport 54321 generation 0',
    'a=end-of-candidates',
  ].join('\r\n');

  it('removes host candidates', () => {
    const out = filterLocalSdp(sdp);
    expect(out).not.toContain('192.168.1.10 54321 typ host');
  });

  it('scrubs raddr/rport on kept candidates', () => {
    const out = filterLocalSdp(sdp);
    expect(out).toContain('raddr 0.0.0.0 rport 0');
    expect(out).not.toMatch(/raddr 192\.168\.1\.10/);
  });

  it('neutralises a private default connection address', () => {
    const out = filterLocalSdp(sdp);
    expect(out).toContain('c=IN IP4 0.0.0.0');
    expect(out).not.toMatch(/^c=IN IP4 192\.168/m);
  });

  it('neutralises a private rtcp address', () => {
    const out = filterLocalSdp(sdp);
    expect(out).not.toMatch(/a=rtcp:9 IN IP4 192\.168/);
  });

  it('leaves the rest of the SDP intact', () => {
    const out = filterLocalSdp(sdp);
    expect(out).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111');
    expect(out).toContain('a=end-of-candidates');
  });

  it('returns an empty string unchanged', () => {
    expect(filterLocalSdp('')).toBe('');
  });
});

describe('hardenOpusSdp', () => {
  const opusSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
    'a=extmap:3 urn:ietf:params:rtp-hdrext:toffset',
  ].join('\r\n');

  it('adds cbr=1 to the Opus fmtp line', () => {
    const out = hardenOpusSdp(opusSdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;cbr=1');
  });

  it('does not duplicate an existing cbr parameter', () => {
    const out = hardenOpusSdp(`${opusSdp.replace('useinbandfec=1', 'useinbandfec=1;cbr=1')}`);
    expect(out.match(/cbr=1/g)).toHaveLength(1);
  });

  it('removes the cleartext audio-level extmap', () => {
    const out = hardenOpusSdp(opusSdp);
    expect(out).not.toContain('ssrc-audio-level');
  });

  it('keeps unrelated header extensions', () => {
    const out = hardenOpusSdp(opusSdp);
    expect(out).toContain('a=extmap:3 urn:ietf:params:rtp-hdrext:toffset');
  });

  it('returns an empty string unchanged', () => {
    expect(hardenOpusSdp('')).toBe('');
  });
});

describe('blankPrivateDefaultAddress', () => {
  it('passes through a description without sdp', () => {
    expect(blankPrivateDefaultAddress({ type: 'offer' })).toEqual({
      type: 'offer',
    });
  });

  it('filters an sdp-bearing description', () => {
    const result = blankPrivateDefaultAddress({
      type: 'answer',
      sdp: 'c=IN IP4 192.168.1.10\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
    });
    expect(result!.sdp).toContain('c=IN IP4 0.0.0.0');
  });

  it('tolerates null input', () => {
    expect(blankPrivateDefaultAddress(null)).toBeNull();
  });
});
