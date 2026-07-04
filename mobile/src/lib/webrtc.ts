/**
 * Lazy loader for the native WebRTC + InCallManager modules.
 *
 * react-native-webrtc only exists in dev-client / release builds — Expo Go,
 * web and Jest would crash on a top-level import. Everything call-related
 * must go through these getters and tolerate a null return (feature is then
 * hidden / disabled gracefully).
 *
 * ANTI-FRAGILE: Uses THREE layers of protection:
 *   1. Expo Go detection — skip require entirely in store-client env
 *   2. NativeModules.WebRTCModule pre-check — avoid triggering Metro's
 *      ErrorUtils reporting during module evaluation
 *   3. try/catch fallback — safety net for any edge case
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';

export type CallPermissionResult = 'granted' | 'denied' | 'blocked';

export interface WebRTCModule {
  RTCPeerConnection: any;
  RTCView: any;
  RTCSessionDescription: any;
  RTCIceCandidate: any;
  MediaStream: any;
  mediaDevices: {
    getUserMedia: (constraints: unknown) => Promise<any>;
  };
}

let webrtc: WebRTCModule | null | undefined;
let inCall: any | null | undefined;

export function getWebRTC(): WebRTCModule | null {
  if (webrtc === undefined) {
    webrtc = null; // default — reset any partial state

    // Layer 1: Expo Go → native modules never work
    if (Constants.executionEnvironment === 'storeClient') {
      return null;
    }

    // Layer 2: pre-check native module presence BEFORE require().
    // react-native-webrtc's index.js checks `NativeModules.WebRTCModule === null`
    // at module-evaluation time and throws if truthy. It uses the old Bridge
    // API (`NativeModules`), not TurboModules — so in the New Architecture
    // (Fabric / RN 0.81+) the module must be linked via the dev-client config
    // plugin, not the TurboModule registry.
    //
    // Known pitfall: in RN 0.81 New Architecture, an unregistered module may
    // return an empty object `{}` (Proxy) instead of `null`/`undefined`,
    // passing the simple truthiness check. We therefore also verify the module
    // has at least one expected method.
    const rtcNativeModule: any = NativeModules.WebRTCModule;
    if (!rtcNativeModule) return null;
    if (typeof rtcNativeModule !== 'object') return null;
    // A real WebRTCModule must have at least one of these key methods.
    // An empty New Arch stub has no methods — catch it.
    const hasMethods =
      typeof rtcNativeModule.getUserMedia === 'function' ||
      typeof rtcNativeModule.peerConnectionInit === 'function';
    if (!hasMethods) {
      console.warn(
        '[webrtc] NativeModules.WebRTCModule found but has no expected methods — ' +
        'likely an empty New Architecture stub. Calls will be unavailable.',
        Object.keys(rtcNativeModule),
      );
      return null;
    }

    // Layer 3: try/catch safety net for any edge case
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      webrtc = require('react-native-webrtc') ?? null;
    } catch {
      webrtc = null;
    }
  }
  return webrtc ?? null;
}

/** react-native-incall-manager — audio routing (earpiece/speaker), ringtones,
 *  proximity sensor. Optional: calls still work without it, just without
 *  speaker toggle / ringback. */
export function getInCallManager(): any | null {
  if (inCall !== undefined) return inCall;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    inCall = require('react-native-incall-manager').default;
  } catch {
    inCall = null;
  }
  return inCall;
}

export function isCallSupported(): boolean {
  return getWebRTC() != null;
}

/**
 * Requests mic (+ camera for video calls) before touching getUserMedia.
 *
 * In React Native 0.81 with the New Architecture, PermissionsAndroid's
 * TurboModule may not be registered in Expo dev-client builds, causing
 * PermissionsAndroid.request() to throw "not installed correctly."
 *
 * This function tries TWO paths:
 *   1. NativeModules.PermissionsAndroid (old bridge — still registered)
 *   2. PermissionsAndroid.request() (TurboModule — may fail)
 *
 * No-op (always granted) on iOS: getUserMedia drives the native TCC prompt.
 */
export async function requestCallPermissions(kind: 'audio' | 'video'): Promise<CallPermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  async function requestOne(perm: string): Promise<'granted' | 'denied' | 'blocked'> {
    // Path 1: Try the old-bridge NativeModules API directly.
    const NativePerms = NativeModules.PermissionsAndroid as
      | { requestPermission: (p: string) => Promise<string> }
      | undefined;
    if (NativePerms?.requestPermission) {
      try {
        const result = await NativePerms.requestPermission(perm);
        console.warn(`[webrtc] NativeModules.PermissionsAndroid path → ${result}`);
        if (result === 'granted') return 'granted';
        if (result === 'never_ask_again') return 'blocked';
        return 'denied';
      } catch (e) {
        console.warn(`[webrtc] NativeModules path failed:`, e);
        return 'denied';
      }
    }

    console.warn(`[webrtc] NativeModules.PermissionsAndroid not found, trying TurboModule path`);
    // Path 2: Fall back to the standard PermissionsAndroid TurboModule path.
    try {
      const result = await PermissionsAndroid.request(perm);
      console.warn(`[webrtc] PermissionsAndroid.request path → ${result}`);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
      return 'denied';
    } catch (e) {
      console.warn(`[webrtc] PermissionsAndroid.request threw:`, e);
      return 'denied';
    }
  }

  const micResult = await requestOne(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (micResult !== 'granted') return micResult;

  if (kind === 'video') {
    const camResult = await requestOne(PermissionsAndroid.PERMISSIONS.CAMERA);
    return camResult;
  }

  return 'granted';
}

/**
 * Direct getUserMedia that bypasses both our own PermissionsAndroid calls
 * AND react-native-webrtc's internal Permissions.request().
 *
 * On Expo 54 / RN 0.81 dev-client builds the PermissionsAndroid TurboModule
 * may not be registered, causing all PermissionsAndroid.request() calls to
 * silently deny — even when the user has manually granted the permission
 * via Settings.  This function calls the native WebRTCModule.getUserMedia
 * directly so that:
 *   - If the user granted the permission via Settings → audio works
 *   - If not → the native AudioRecord yields silence, not a crash
 *
 * The stream/track construction matches what react-native-webrtc's own
 * getUserMedia does internally, minus the permission guard.
 */
export async function getUserMediaDirect(
  rtc: WebRTCModule,
  kind: CallKind,
): Promise<any> {
  // Native WebRTCModule.getUserMedia expects `audio` / `video` to be Maps
  // (ReadableNativeMap), not booleans — same format that react-native-webrtc's
  // normalizeConstraints produces: `true` → `{}`.
  const constraints: Record<string, any> = { audio: {} };
  if (kind === 'video') {
    // Must match what react-native-webrtc's normalizeConstraints produces:
    // width/height/frameRate as plain ints + facingMode + deviceId (optional)
    constraints.video = { facingMode: 'user', width: 1280, height: 720, frameRate: 30 };
  }

  const NativeRTC = NativeModules.WebRTCModule;
  if (!NativeRTC) throw new Error('WebRTC native module not available');

  return new Promise((resolve, reject) => {
    NativeRTC.getUserMedia(
      constraints,
      (streamId: string, tracks: any[]) => {
        const stream = new rtc.MediaStream({
          streamId,
          streamReactTag: streamId,
          tracks,
        });
        resolve(stream);
      },
      (type: string, message: string) => {
        reject(new Error(`getUserMedia native error: ${type} ${message}`));
      },
    );
  });
}

/** STUN-only fallback when /chat/turn-credentials is unreachable or the
 *  server has no TURN configured. Covers ~80-85% of NAT setups; two-sided
 *  CGNAT needs the TURN relay from the backend response. */
export const FALLBACK_ICE_SERVERS: { urls: string[] }[] = [
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
];
