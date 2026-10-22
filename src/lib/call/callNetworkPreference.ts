/**
 * P-4: "Private calls (Reticulum only)".
 *
 * When enabled, WebRTC is never negotiated for DM or group audio: no
 * capability is advertised or acknowledged, no RTC signal is sent, and no
 * PeerConnection is created. Peers that never see a capability stay on
 * Reticulum media, so no IP address is ever exchanged.
 *
 * This is a runtime flag rather than a compile-time constant so the setting can
 * be toggled without a rebuild. It mirrors the `callReticulumOnly` app setting.
 */

let reticulumOnly = false;
/**
 * X-2: "do not elect me as forwarder". Phones are elected root about 1/N of
 * the time, and Android may freeze a backgrounded app, so a phone root is a
 * bad outcome even when the digest picks it.
 */
let dontForward = false;

/** True when the user has opted out of WebRTC for calls. */
export function isCallReticulumOnly(): boolean {
  return reticulumOnly;
}

/**
 * Apply the setting. Called on startup from `getAppSettings()` and whenever the
 * setting changes, so both the main shell and the hidden audio-surface agree.
 */
export function setCallReticulumOnly(enabled: boolean): void {
  reticulumOnly = enabled === true;
}

/** X-2: true when the user asked not to be elected forwarder. */
export function isCallDontForward(): boolean {
  return dontForward;
}

/** X-2: apply the setting; mirrored from `callDontForward`. */
export function setCallDontForward(enabled: boolean): void {
  dontForward = enabled === true;
}
