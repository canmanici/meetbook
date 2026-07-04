/**
 * Zustand store driving 1:1 WebRTC audio/video calls.
 *
 * State machine:
 *   idle → outgoing (ringing) ─┬→ connecting → active → ended → idle
 *   idle → incoming (ringing) ─┘
 *
 * Signaling rides the existing chat WebSocket (`chatWS.sendCall`); the
 * backend relays offer/answer/ICE between the two exchange participants and
 * persists a call-log system message when we attach a `log` to the
 * terminating event. Exactly ONE side sends the log:
 *   - caller logs 'missed' (timeout/cancel) and 'ended' (hang up while active)
 *   - callee logs 'rejected'
 *   - if the callee hangs up an active call, the callee logs 'ended'
 */
import { create } from 'zustand';
import { Vibration } from 'react-native';

import { chatWS, getTurnCredentials, type IceServerConfig, type WSMessage } from '@/lib/api/chat';
import { getWebRTC, getInCallManager, requestCallPermissions, getUserMediaDirect, FALLBACK_ICE_SERVERS } from '@/lib/webrtc';

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type CallKind = 'audio' | 'video';
export type CallEndReason =
  | 'ended' | 'rejected' | 'missed' | 'busy' | 'unavailable' | 'failed' | 'cancelled'
  | 'permission-denied' | 'permission-blocked' | null;

/** User-facing quality preference. 'auto' lets the bandwidth monitor drive. */
export type CallQuality = 'auto' | 'low' | 'medium' | 'high';
/** Live connection health derived from WebRTC stats (packet loss + RTT). */
export type NetworkQuality = 'good' | 'fair' | 'poor';

const RING_TIMEOUT_MS = 30_000;
const ENDED_SCREEN_MS = 1_800;
// Max time allowed in 'connecting' (answer sent/received but no media yet)
// before giving up — without this the callee can sit on "bağlanıyor" forever.
const CONNECT_TIMEOUT_MS = 20_000;
// ICE restart budget per call: WiFi→4G handoff needs 1; give a spare for a
// double network change. Beyond that the link is genuinely gone.
const MAX_ICE_RESTARTS = 2;
// How long 'disconnected' must persist before we try an ICE restart —
// transient radio blips usually self-heal within a couple of seconds.
const DISCONNECT_GRACE_MS = 3_000;

interface PeerInfo {
  id?: string;
  name: string;
  avatarUrl?: string | null;
}

interface CallState {
  status: CallStatus;
  callId: string | null;
  chatId: string | null;
  kind: CallKind;
  isCaller: boolean;
  peer: PeerInfo;
  endReason: CallEndReason;

  isMuted: boolean;
  isSpeakerOn: boolean;
  isCameraOn: boolean;
  isFrontCamera: boolean;

  localStream: any | null;
  remoteStream: any | null;
  startedAt: number | null;

  bindSignaling: () => void;
  startCall: (chatId: string, kind: CallKind, peer: PeerInfo) => Promise<boolean>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;

  quality: CallQuality;
  networkQuality: NetworkQuality;
  setQuality: (q: CallQuality) => void;
}

// Non-reactive internals — the peer connection and timers don't belong in
// React state.
let pc: any | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let endedTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOffer: any | null = null;
// ICE candidates buffered before the PC has a remote description. Tagged with
// the call id they belong to so a new call can never ingest a stale batch,
// and so candidates that arrive BEFORE the offer (very common: the caller's
// host/srflx candidates fire within ms of setLocalDescription and can outrun
// the offer over the relay) are kept instead of dropped.
let pendingIce: any[] = [];
let pendingIceCallId: string | null = null;
let signalingBound = false;

function bufferIce(callId: string, candidate: any) {
  if (pendingIceCallId !== callId) {
    pendingIce = [];
    pendingIceCallId = callId;
  }
  pendingIce.push(candidate);
}

// Cached ephemeral TURN credentials — refetched when within 5 min of expiry.
// The credential itself is a time-limited HMAC minted by the backend, so
// caching client-side is safe: it dies server-side at the same moment.
let cachedIce: { servers: IceServerConfig[]; expiresAt: number } | null = null;

async function getIceServers(): Promise<IceServerConfig[]> {
  if (cachedIce && Date.now() < cachedIce.expiresAt - 5 * 60_000) {
    return cachedIce.servers;
  }
  try {
    const res = await getTurnCredentials();
    if (res.ice_servers.length > 0) {
      // Strip null username/credential — native WebRTC throws
      // "Exception in HostFunction: username == null" if a STUN-only
      // server object carries `"username": null, "credential": null`.
      const clean = res.ice_servers.map((s) => {
        const out: IceServerConfig = { urls: s.urls };
        if (s.username) out.username = s.username;
        if (s.credential) out.credential = s.credential;
        return out;
      });
      cachedIce = {
        servers: clean,
        // ttl 0 == STUN-only response; still cache briefly to avoid hammering
        expiresAt: Date.now() + Math.max(res.ttl_seconds, 300) * 1000,
      };
      return clean;
    }
  } catch {
    // Backend unreachable or endpoint missing — degrade to STUN-only.
  }
  return FALLBACK_ICE_SERVERS;
}

function newCallId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Adaptive quality ─────────────────────────────────────────────────────
//
// WebRTC's congestion control (transport-cc/REMB) already adapts the encoder
// to available bandwidth on its own. What it does NOT do is cap the ceiling:
// on a metered 4G connection it will happily climb to 2.5 Mbps if the link
// allows. These presets bound the encoder via RTCRtpSender.setParameters,
// and the stats monitor steps the AUTO level down/up based on observed
// packet loss + RTT — reacting faster than congestion control alone and
// surfacing a quality indicator the UI can show.

const VIDEO_PRESETS: Record<'low' | 'medium' | 'high', { maxBitrate: number; scaleDown: number; maxFramerate: number }> = {
  low: { maxBitrate: 250_000, scaleDown: 4, maxFramerate: 15 },   // ~240p — survives 2G/edge-of-coverage
  medium: { maxBitrate: 800_000, scaleDown: 2, maxFramerate: 24 }, // ~360p — comfortable on 4G
  high: { maxBitrate: 2_500_000, scaleDown: 1, maxFramerate: 30 }, // 720p — wifi / strong LTE
};

const STATS_INTERVAL_MS = 3_000;

let statsTimer: ReturnType<typeof setInterval> | null = null;
// Previous cumulative counters for delta-based packet-loss calculation.
let prevPackets: { sent: number; lost: number } | null = null;
// Consecutive good/bad readings before stepping auto level up/down —
// prevents flapping on a single noisy sample.
let goodStreak = 0;
let badStreak = 0;
let autoLevel: 'low' | 'medium' | 'high' = 'high';
// How this call's media actually flows: 'direct' = P2P (host/srflx),
// 'relay' = through our TURN server. Attached to the call log for the
// admin P2P-vs-relay ratio metric.
let connRoute: 'direct' | 'relay' | null = null;
// Relayed calls burn OUR bandwidth, not just the users' — cap the video
// ceiling at 'medium' (~800 kbit/s) when the selected pair is a relay.
let maxLevel: 'medium' | 'high' = 'high';
let restartAttempts = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Clamp a preset level to the relay-aware ceiling. */
function clampLevel(l: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  return l === 'high' && maxLevel === 'medium' ? 'medium' : l;
}

/** Read the selected candidate pair off getStats and classify the route. */
async function detectRoute(): Promise<'direct' | 'relay' | null> {
  if (!pc) return null;
  try {
    const stats: Map<string, any> = await pc.getStats();
    const pairs = new Map<string, any>();
    const locals = new Map<string, any>();
    let selectedId: string | null = null;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) selectedId = s.selectedCandidatePairId;
      if (s.type === 'candidate-pair') pairs.set(s.id, s);
      if (s.type === 'local-candidate') locals.set(s.id, s);
    });
    let pair = selectedId ? pairs.get(selectedId) : null;
    if (!pair) {
      pairs.forEach((p) => {
        if (p.selected || (p.state === 'succeeded' && p.nominated)) pair = p;
      });
    }
    const local = pair ? locals.get(pair.localCandidateId) : null;
    if (!local) return null;
    return local.candidateType === 'relay' ? 'relay' : 'direct';
  } catch {
    return null;
  }
}

async function applyVideoPreset(level: 'low' | 'medium' | 'high') {
  if (!pc) return;
  try {
    const senders: any[] = pc.getSenders?.() ?? [];
    const videoSender = senders.find((s) => s.track?.kind === 'video');
    if (!videoSender) return;
    const preset = VIDEO_PRESETS[level];
    const params = videoSender.getParameters();
    const encCount = params.encodings?.length ?? 0;

    // ── Encoding count parity ─────────────────────────────────────────
    // The native `updateRtpParameters` (both Android & iOS) STRICTLY
    // checks that the incoming encodings array size matches the native
    // sender's current encoding count. If they differ, the call silently
    // rejects (Android returns null → NPE in setParameters → promise
    // reject; iOS returns nil → setParameters:nil is a no-op).
    //
    // Our `getParameters()` returns the JS-side `_rtpParameters` which
    // is initialized from the native sender's serialized rtpParameters.
    // If they diverge (e.g., 0 native encodings), pad with `active: true`.
    //
    // Second pitfall: `RTCRtpEncodingParameters.toJSON()` always includes
    // `active` — but the `[{}]` fallback is a plain object WITHOUT it.
    // Android's `getBoolean("active")` throws on missing keys.  Always
    // ensure every encoding object has `active: true` set explicitly.
    if (encCount === 0) {
      params.encodings = [{ active: true }];
    } else {
      for (let i = 0; i < encCount; i++) {
        if (params.encodings[i].active == null) {
          (params.encodings[i] as any).active = true;
        }
      }
    }

    params.encodings[0].maxBitrate = preset.maxBitrate;
    params.encodings[0].scaleResolutionDownBy = preset.scaleDown;
    params.encodings[0].maxFramerate = preset.maxFramerate;
    await videoSender.setParameters(params);
  } catch (e) {
    console.warn('[call-store] applyVideoPreset failed — encoder may ignore dynamic params:', e);
  }
}

/** Pull packet-loss % and RTT out of a getStats() report. */
function readStats(report: Map<string, any>): { lossPct: number; rttMs: number } {
  let sent = 0;
  let lost = 0;
  let rttMs = 0;
  report.forEach((s) => {
    if (s.type === 'outbound-rtp') sent += s.packetsSent ?? 0;
    if (s.type === 'remote-inbound-rtp') {
      lost += s.packetsLost ?? 0;
      const rtt = (s.roundTripTime ?? 0) * 1000;
      if (rtt > rttMs) rttMs = rtt;
    }
  });
  let lossPct = 0;
  if (prevPackets) {
    const dSent = sent - prevPackets.sent;
    const dLost = lost - prevPackets.lost;
    if (dSent + dLost > 0) lossPct = (100 * dLost) / (dSent + dLost);
  }
  prevPackets = { sent, lost };
  return { lossPct: Math.max(0, lossPct), rttMs };
}

function stopStatsMonitor() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  prevPackets = null;
  goodStreak = 0;
  badStreak = 0;
  autoLevel = 'high';
  connRoute = null;
  maxLevel = 'high';
  restartAttempts = 0;
  if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
}

function permissionReason(e: unknown): CallEndReason | null {
  const msg = e instanceof Error ? e.message : undefined;
  if (msg === 'permission-denied' || msg === 'permission-blocked') return msg;
  return null;
}

function clearTimers() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (endedTimer) { clearTimeout(endedTimer); endedTimer = null; }
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
}

/**
 * Force-releases a PeerConnection + its local tracks in the safe order:
 * detach senders → close the PC → THEN stop/release local tracks. Releasing
 * a native track while it's still attached to a live PeerConnection corrupts
 * the app-lifetime-shared native AudioDeviceModule, killing audio on every
 * call after the first until the app is restarted (the bug this whole file
 * was hardened against). Every exceptional path — including partial setup
 * failures inside `createPeerConnection` — must funnel through this, not
 * just the normal teardown path, so no native resource can leak silently.
 *
 * Each step is independently try/caught: one throwing (e.g. a sender already
 * detached) must never skip the later steps, or we're back to leaking.
 */
function forceCloseConn(conn: any | null, stream?: any | null) {
  try {
    conn?.getSenders?.().forEach((s: any) => { try { conn.removeTrack(s); } catch {} });
  } catch {}
  try { conn?.close(); } catch {}
  // stop() alone only disables the track on react-native-webrtc; release()
  // is required to actually free the native AudioTrack/AudioSource.
  try {
    stream?.getTracks?.().forEach((t: any) => { try { t.stop(); t.release?.(); } catch {} });
  } catch {}
}

function stopMedia(state: { localStream: any | null }) {
  forceCloseConn(pc, state.localStream);
  pc = null;

  pendingOffer = null;
  pendingIce = [];
  pendingIceCallId = null;
  const icm = getInCallManager();
  // Separate try/catch per call: if stopRingtone() throws, stop() must still
  // run — otherwise native `audioManagerActivated` stays stuck true and the
  // NEXT call's icm.start() silently no-ops, never reconfiguring audio routing.
  try { icm?.stopRingtone(); } catch {}
  try { icm?.stop(); } catch {}
  Vibration.cancel();
}

export const useCallStore = create<CallState>((set, get) => {
  // ── helpers ─────────────────────────────────────────────────────────

  function teardown(reason: CallEndReason, log?: 'ended' | 'missed' | 'rejected' | 'failed') {
    const { chatId, callId, kind, startedAt, status } = get();
    clearTimers();
    if (log && chatId && callId) {
      const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
      const event = log === 'rejected' ? 'reject' : status === 'outgoing' ? 'cancel' : 'end';
      // Reliable, fire-and-forget: a dropped cancel/end/reject leaves the
      // other side ringing or in a dead call with no way to know it's over.
      void chatWS.sendCallReliable(chatId, event, callId, kind, undefined, {
        status: log,
        duration_seconds: duration,
        route: connRoute,
      });
    }
    stopStatsMonitor();
    stopMedia(get());
    set({
      status: 'ended',
      endReason: reason,
      localStream: null,
      remoteStream: null,
      networkQuality: 'good',
    });
    endedTimer = setTimeout(() => {
      set({
        status: 'idle', callId: null, chatId: null, endReason: null,
        isMuted: false, isSpeakerOn: false, isCameraOn: true,
        isFrontCamera: true, startedAt: null,
      });
    }, ENDED_SCREEN_MS);
  }

  async function createPeerConnection(kind: CallKind): Promise<any | null> {
    const rtc = getWebRTC();
    if (!rtc) return null;
    const { chatId, callId } = get();
    const iceServers = await getIceServers();
    const conn = new rtc.RTCPeerConnection({ iceServers });

    conn.addEventListener('icecandidate', (e: any) => {
      if (e.candidate && chatId && callId) {
        // Reliable: a dropped candidate is invisible but degrades or kills
        // connectivity (the "connects 15s late / never" bug).
        void chatWS.sendCallReliable(chatId, 'ice', callId, kind, e.candidate);
      }
    });
    conn.addEventListener('track', (e: any) => {
      if (e.streams && e.streams[0]) {
        set({ remoteStream: e.streams[0] });
      }
    });
    conn.addEventListener('connectionstatechange', () => {
      const cs = conn.connectionState;
      if (cs === 'connected') {
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
        restartAttempts = 0;
        // Classify the route (P2P vs TURN relay) once media flows — feeds
        // the call-log telemetry and the relay bandwidth cap. Re-run after
        // an ICE restart too: the route may have changed with the network.
        void detectRoute().then((route) => {
          if (!route || pc !== conn) return;
          connRoute = route;
          if (route === 'relay') {
            maxLevel = 'medium';
            autoLevel = clampLevel(autoLevel);
            const q = get().quality;
            if (get().kind === 'video' && get().status === 'active') {
              void applyVideoPreset(q === 'auto' ? autoLevel : clampLevel(q));
            }
          }
        });
        if (get().status !== 'active') {
          clearTimers();
          set({ status: 'active', startedAt: get().startedAt ?? Date.now() });
          startStatsMonitor();
          // Apply the user's preference (or the auto ceiling) once media flows.
          const q = get().quality;
          if (get().kind === 'video') void applyVideoPreset(q === 'auto' ? autoLevel : clampLevel(q));
          const icm = getInCallManager();
          try {
            icm?.stopRingback();
            if (get().kind === 'audio' && !get().isSpeakerOn) icm?.setForceSpeakerphoneOn(false);
          } catch {}
        }
      } else if (cs === 'disconnected') {
        // Usually a network handoff (WiFi→4G) — give it a grace period to
        // self-heal, then let the caller drive an ICE restart. Only the
        // caller restarts: both sides restarting glares the negotiation.
        if (get().status === 'active' && get().isCaller && !disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            if (conn.connectionState === 'disconnected' && get().status === 'active') {
              void attemptIceRestart();
            }
          }, DISCONNECT_GRACE_MS);
        }
      } else if (cs === 'failed') {
        if (get().status === 'active' && get().isCaller && restartAttempts < MAX_ICE_RESTARTS) {
          void attemptIceRestart();
          return;
        }
        teardown('failed', get().isCaller ? 'failed' : undefined);
      }
    });

    // Everything below can throw partway through (permission denied/blocked,
    // getUserMedia rejecting, addTrack throwing) — at that point `conn` is
    // already a live native RTCPeerConnection with listeners registered, and
    // `stream` may already hold live native tracks. Neither is referenced by
    // module-level `pc` yet (that assignment happens in the caller after we
    // return), so if we just let the exception propagate, both leak silently.
    // Route every failure through forceCloseConn before rethrowing.
    let stream: any = null;
    try {
      const permission = await requestCallPermissions(kind);

      // 'blocked' = user selected "never ask again" → nothing we can do.
      // 'denied'  = user denied OR the native PermissionsAndroid module is
      //             unavailable (common in Expo 54 dev-client w/ New Arch) —
      //             still try getUserMedia in case the user granted manually
      //             via Settings, or the WebRTC native layer handles it.
      if (permission === 'blocked') {
        throw new Error('permission-blocked');
      }

      stream = await getUserMediaDirect(rtc, kind);
      stream.getTracks().forEach((t: any) => conn.addTrack(t, stream));
      set({ localStream: stream });
      return conn;
    } catch (e) {
      forceCloseConn(conn, stream);
      throw e;
    }
  }

  /** Caller-side ICE restart: re-negotiate transport without tearing down
   *  media. Survives WiFi→cellular handoffs that would otherwise kill the
   *  call. The re-offer rides the same call id; the callee answers it in
   *  the 'offer' signal handler below. */
  async function attemptIceRestart() {
    const { chatId, callId, kind, status } = get();
    if (!pc || !chatId || !callId || status !== 'active') return;
    if (restartAttempts >= MAX_ICE_RESTARTS) {
      teardown('failed', 'failed');
      return;
    }
    restartAttempts += 1;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await chatWS.sendCallReliable(chatId, 'offer', callId, kind, pc.localDescription);
    } catch (e) {
      console.warn('[call-store] ICE restart failed:', e);
      teardown('failed', 'failed');
    }
  }

  function startStatsMonitor() {
    if (statsTimer) return;
    statsTimer = setInterval(async () => {
      if (!pc || get().status !== 'active') return;
      let stats: Map<string, any>;
      try {
        stats = await pc.getStats();
      } catch {
        return;
      }
      const { lossPct, rttMs } = readStats(stats);

      // Classify link health for the UI indicator.
      const nq: NetworkQuality =
        lossPct > 8 || rttMs > 500 ? 'poor'
        : lossPct > 3 || rttMs > 250 ? 'fair'
        : 'good';
      if (nq !== get().networkQuality) set({ networkQuality: nq });

      // AUTO mode: step the video ceiling down fast, up slowly.
      if (get().quality !== 'auto' || get().kind !== 'video') return;
      if (nq === 'poor') { badStreak += 1; goodStreak = 0; }
      else if (nq === 'good') { goodStreak += 1; badStreak = 0; }
      else { goodStreak = 0; badStreak = 0; }

      if (badStreak >= 2 && autoLevel !== 'low') {
        autoLevel = autoLevel === 'high' ? 'medium' : 'low';
        badStreak = 0;
        void applyVideoPreset(autoLevel);
      } else if (goodStreak >= 5 && autoLevel !== maxLevel) {
        // Step up, but never past the relay-aware ceiling: TURN-relayed
        // calls stay ≤ medium so they don't eat our server bandwidth.
        autoLevel = clampLevel(autoLevel === 'low' ? 'medium' : 'high');
        goodStreak = 0;
        void applyVideoPreset(autoLevel);
      }
    }, STATS_INTERVAL_MS);
  }

  function startAudioSession(kind: CallKind, ringback: boolean) {
    const icm = getInCallManager();
    if (!icm) return;
    try {
      // '_DEFAULT_' plays the device's actual system ringtone (via
      // getDefaultUserUri on Android), the same sound used for a real
      // incoming call — that's what made the caller's own phone "ring".
      // '_BUNDLE_' is a distinct, dedicated dial/ringback tone bundled with
      // the library, so the caller hears a normal dialing tone instead.
      icm.start({ media: kind, ringback: ringback ? '_BUNDLE_' : '' });
      if (kind === 'video') {
        icm.setForceSpeakerphoneOn(true);
        set({ isSpeakerOn: true });
      }
    } catch {}
  }

  // ── incoming signal handling ────────────────────────────────────────

  async function onSignal(msg: WSMessage) {
    if (msg.type !== 'call' || !msg.event) return;
    const s = get();

    switch (msg.event) {
      case 'offer': {
        // Busy: already in a call (or ringing) for a different call id.
        if (s.status !== 'idle' && s.callId !== msg.call_id) {
          if (msg.chat_id && msg.call_id) {
            void chatWS.sendCallReliable(msg.chat_id, 'busy', msg.call_id, msg.kind ?? 'audio');
          }
          return;
        }
        // Re-offer for the live call = caller-initiated ICE restart
        // (network handoff). Answer it in place — no ringing, no state
        // change, media resumes on the new transport.
        if (s.status === 'active' && s.callId === msg.call_id && pc && msg.chat_id) {
          const rtc = getWebRTC();
          if (!rtc || !msg.payload) return;
          try {
            await pc.setRemoteDescription(new rtc.RTCSessionDescription(msg.payload as any));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            void chatWS.sendCallReliable(msg.chat_id, 'answer', msg.call_id, s.kind, pc.localDescription);
          } catch (e) {
            console.warn('[call-store] ICE restart answer failed:', e);
          }
          return;
        }
        if (s.status !== 'idle') return; // duplicate offer for same call
        pendingOffer = msg.payload;
        // Keep candidates that arrived ahead of this offer; discard buffers
        // belonging to any other call.
        if (pendingIceCallId !== msg.call_id) {
          pendingIce = [];
          pendingIceCallId = msg.call_id ?? null;
        }
        set({
          status: 'incoming',
          callId: msg.call_id ?? null,
          chatId: msg.chat_id ?? null,
          kind: msg.kind ?? 'audio',
          isCaller: false,
          endReason: null,
          peer: { id: msg.sender_id, name: msg.sender_name || 'Bilinmeyen', avatarUrl: null },
        });
        const icm = getInCallManager();
        try { icm?.startRingtone('_DEFAULT_'); } catch {}
        Vibration.vibrate([800, 1200], true);
        // Auto-dismiss if caller gives up silently (network death etc.).
        ringTimer = setTimeout(() => {
          if (get().status === 'incoming') teardown('missed');
        }, RING_TIMEOUT_MS + 5_000);
        break;
      }

      case 'answer': {
        if (s.callId !== msg.call_id || !pc) return;
        const rtc = getWebRTC();
        if (!rtc) return;
        // Answer to an ICE-restart re-offer: the call is already live —
        // just install the new remote description, don't touch UI state.
        if (s.status === 'active') {
          try {
            await pc.setRemoteDescription(new rtc.RTCSessionDescription(msg.payload as any));
          } catch (e) {
            console.warn('[call-store] restart answer setRemoteDescription failed:', e);
          }
          break;
        }
        clearTimers();
        set({ status: 'connecting' });
        connectTimer = setTimeout(() => {
          if (get().status === 'connecting') teardown('failed', 'failed');
        }, CONNECT_TIMEOUT_MS);
        try {
          await pc.setRemoteDescription(new rtc.RTCSessionDescription(msg.payload as any));
          if (pendingIceCallId === msg.call_id) {
            for (const c of pendingIce) {
              try { await pc.addIceCandidate(new rtc.RTCIceCandidate(c)); } catch {}
            }
          }
          pendingIce = [];
          pendingIceCallId = null;
        } catch {
          teardown('failed', 'failed');
        }
        break;
      }

      case 'ice': {
        if (!msg.call_id || !msg.payload) return;
        // Candidates can arrive BEFORE the offer (caller's early candidates
        // outrunning the offer over the relay) — at that point our callId is
        // still null. Buffer them keyed by call id instead of dropping; the
        // offer handler / acceptCall drains the buffer for the matching call.
        if (s.callId !== msg.call_id) {
          if (s.status === 'idle') bufferIce(msg.call_id, msg.payload);
          return;
        }
        const rtc = getWebRTC();
        if (!rtc) return;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(new rtc.RTCIceCandidate(msg.payload as any)); } catch {}
        } else {
          // Candidates can arrive before the answer/accept — buffer them.
          bufferIce(msg.call_id, msg.payload);
        }
        break;
      }

      case 'reject':
        if (s.callId === msg.call_id) teardown('rejected');
        break;
      case 'busy':
        if (s.callId === msg.call_id) teardown('busy');
        break;
      case 'unavailable':
        if (s.callId === msg.call_id) teardown('unavailable', 'missed');
        break;
      case 'cancel':
      case 'end':
        if (s.callId === msg.call_id) teardown('ended');
        break;
    }
  }

  return {
    status: 'idle',
    callId: null,
    chatId: null,
    kind: 'audio',
    isCaller: false,
    peer: { name: '' },
    endReason: null,
    isMuted: false,
    isSpeakerOn: false,
    isCameraOn: true,
    isFrontCamera: true,
    localStream: null,
    remoteStream: null,
    startedAt: null,

    bindSignaling: () => {
      if (signalingBound) return;
      signalingBound = true;
      chatWS.subscribe((msg) => { void onSignal(msg); });
    },

    startCall: async (chatId, kind, peer) => {
      if (get().status !== 'idle') return false;
      // Defensive: a prior failed attempt should always have cleaned up via
      // stopMedia()/teardown(), but if anything ever leaked a stale `pc` or
      // `localStream`, force-release it before acquiring new native
      // resources rather than layering a second PC/track set on top.
      if (pc || get().localStream) {
        forceCloseConn(pc, get().localStream);
        pc = null;
        set({ localStream: null });
      }
      const rtc = getWebRTC();
      if (!rtc) {
        console.warn('[call-store] getWebRTC() returned null');
        set({ endReason: 'failed', status: 'idle' });
        return false;
      }

      const callId = newCallId();
      set({
        status: 'outgoing', callId, chatId, kind, isCaller: true, peer,
        endReason: null, isCameraOn: true, isMuted: false,
      });

      // The user can hit "iptal" while any of the awaits below are pending
      // (getUserMedia alone can take seconds behind a permission prompt).
      // teardown() will have already run at that point — without this guard
      // the resumed continuation would still send the offer and ring the
      // other side for a call that no longer exists.
      const cancelled = () => get().callId !== callId || get().status !== 'outgoing';
      try {
        const conn = await createPeerConnection(kind);
        if (!conn) throw new Error('no webrtc');
        if (cancelled()) { forceCloseConn(conn, get().localStream); return false; }
        pc = conn;
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        if (cancelled()) { stopMedia(get()); set({ localStream: null }); return false; }
        const sent = await chatWS.sendCallReliable(chatId, 'offer', callId, kind, pc.localDescription);
        if (!sent) throw new Error('ws closed');
        if (cancelled()) {
          // The cancel raced ahead of this offer over the wire — the other
          // side will ring unless we cancel again, now that the offer exists.
          void chatWS.sendCallReliable(chatId, 'cancel', callId, kind);
          stopMedia(get());
          set({ localStream: null });
          return false;
        }
      } catch (e) {
        const reason = permissionReason(e) ?? 'failed';
        console.warn(`[call-store] startCall failed: endReason=${reason} error=`, e);
        teardown(reason);
        return false;
      }

      startAudioSession(kind, true);
      ringTimer = setTimeout(() => {
        if (get().status === 'outgoing') teardown('missed', 'missed');
      }, RING_TIMEOUT_MS);
      return true;
    },

    acceptCall: async () => {
      const { chatId, callId, kind, status } = get();
      if (status !== 'incoming' || !chatId || !callId || !pendingOffer) return;
      // Defensive: same rationale as startCall — never build a new PC on top
      // of a leaked one.
      if (pc || get().localStream) {
        forceCloseConn(pc, get().localStream);
        pc = null;
        set({ localStream: null });
      }
      const rtc = getWebRTC();
      if (!rtc) { teardown('failed'); return; }

      clearTimers();
      const icm = getInCallManager();
      try { icm?.stopRingtone(); } catch {}
      Vibration.cancel();
      set({ status: 'connecting' });

      // Same hang-up-during-await race as startCall: if the user (or a
      // remote cancel) tore the call down while we were acquiring media,
      // don't resurrect it by sending an answer.
      const aborted = () => get().callId !== callId || get().status !== 'connecting';
      try {
        const conn = await createPeerConnection(kind);
        if (!conn) throw new Error('no webrtc');
        if (aborted()) { forceCloseConn(conn, get().localStream); return; }
        pc = conn;
        await pc.setRemoteDescription(new rtc.RTCSessionDescription(pendingOffer));
        pendingOffer = null;
        if (pendingIceCallId === callId) {
          for (const c of pendingIce) {
            try { await pc.addIceCandidate(new rtc.RTCIceCandidate(c)); } catch {}
          }
        }
        pendingIce = [];
        pendingIceCallId = null;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (aborted()) { stopMedia(get()); set({ localStream: null }); return; }
        const sent = await chatWS.sendCallReliable(chatId, 'answer', callId, kind, pc.localDescription);
        if (!sent) throw new Error('ws closed');
        startAudioSession(kind, false);
        connectTimer = setTimeout(() => {
          if (get().status === 'connecting') teardown('failed', 'failed');
        }, CONNECT_TIMEOUT_MS);
      } catch (e) {
        teardown(permissionReason(e) ?? 'failed', 'failed');
      }
    },

    rejectCall: () => {
      if (get().status !== 'incoming') return;
      teardown('rejected', 'rejected');
    },

    endCall: () => {
      const s = get().status;
      if (s === 'idle' || s === 'ended') return;
      if (s === 'outgoing') {
        teardown('cancelled', 'missed');
      } else if (s === 'incoming') {
        teardown('rejected', 'rejected');
      } else {
        teardown('ended', 'ended');
      }
    },

    toggleMute: () => {
      const { localStream, isMuted } = get();
      localStream?.getAudioTracks?.().forEach((t: any) => { t.enabled = isMuted; });
      set({ isMuted: !isMuted });
    },

    toggleSpeaker: () => {
      const { isSpeakerOn } = get();
      const icm = getInCallManager();
      try { icm?.setForceSpeakerphoneOn(!isSpeakerOn); } catch {}
      set({ isSpeakerOn: !isSpeakerOn });
    },

    toggleCamera: () => {
      const { localStream, isCameraOn } = get();
      localStream?.getVideoTracks?.().forEach((t: any) => { t.enabled = !isCameraOn; });
      set({ isCameraOn: !isCameraOn });
    },

    quality: 'auto',
    networkQuality: 'good',

    setQuality: (q) => {
      set({ quality: q });
      if (get().kind !== 'video' || get().status !== 'active') return;
      if (q === 'auto') {
        // Resume from wherever the monitor last settled.
        void applyVideoPreset(autoLevel);
      } else {
        // Manual choice still respects the relay bandwidth ceiling.
        void applyVideoPreset(clampLevel(q));
      }
    },

    switchCamera: () => {
      const { localStream, isFrontCamera } = get();
      localStream?.getVideoTracks?.().forEach((t: any) => {
        try { t._switchCamera(); } catch {}
      });
      set({ isFrontCamera: !isFrontCamera });
    },
  };
});
