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
import { getWebRTC, getInCallManager, requestCallPermissions, FALLBACK_ICE_SERVERS } from '@/lib/webrtc';

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
let pendingOffer: any | null = null;
let pendingIce: any[] = [];
let signalingBound = false;

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
      cachedIce = {
        servers: res.ice_servers,
        // ttl 0 == STUN-only response; still cache briefly to avoid hammering
        expiresAt: Date.now() + Math.max(res.ttl_seconds, 300) * 1000,
      };
      return res.ice_servers;
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

async function applyVideoPreset(level: 'low' | 'medium' | 'high') {
  if (!pc) return;
  try {
    const senders: any[] = pc.getSenders?.() ?? [];
    const videoSender = senders.find((s) => s.track?.kind === 'video');
    if (!videoSender) return;
    const preset = VIDEO_PRESETS[level];
    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = preset.maxBitrate;
    params.encodings[0].scaleResolutionDownBy = preset.scaleDown;
    params.encodings[0].maxFramerate = preset.maxFramerate;
    await videoSender.setParameters(params);
  } catch {
    // Older webrtc builds may not support setParameters — congestion
    // control still adapts, we just lose the explicit ceiling.
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
}

function permissionReason(e: unknown): CallEndReason | null {
  const msg = e instanceof Error ? e.message : undefined;
  if (msg === 'permission-denied' || msg === 'permission-blocked') return msg;
  return null;
}

function clearTimers() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (endedTimer) { clearTimeout(endedTimer); endedTimer = null; }
}

function stopMedia(state: { localStream: any | null }) {
  try {
    state.localStream?.getTracks?.().forEach((t: any) => t.stop());
  } catch {}
  try { pc?.close(); } catch {}
  pc = null;
  pendingOffer = null;
  pendingIce = [];
  const icm = getInCallManager();
  try { icm?.stopRingtone(); icm?.stop(); } catch {}
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
      chatWS.sendCall(chatId, event, callId, kind, undefined, {
        status: log,
        duration_seconds: duration,
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
        chatWS.sendCall(chatId, 'ice', callId, kind, e.candidate);
      }
    });
    conn.addEventListener('track', (e: any) => {
      if (e.streams && e.streams[0]) {
        set({ remoteStream: e.streams[0] });
      }
    });
    conn.addEventListener('connectionstatechange', () => {
      const cs = conn.connectionState;
      if (cs === 'connected' && get().status !== 'active') {
        clearTimers();
        set({ status: 'active', startedAt: get().startedAt ?? Date.now() });
        startStatsMonitor();
        // Apply the user's preference (or the auto ceiling) once media flows.
        const q = get().quality;
        if (get().kind === 'video') void applyVideoPreset(q === 'auto' ? autoLevel : q);
        const icm = getInCallManager();
        try {
          icm?.stopRingback();
          if (get().kind === 'audio' && !get().isSpeakerOn) icm?.setForceSpeakerphoneOn(false);
        } catch {}
      } else if (cs === 'failed') {
        teardown('failed', get().isCaller ? 'failed' : undefined);
      }
    });

    const permission = await requestCallPermissions(kind);
    if (permission !== 'granted') {
      throw new Error(permission === 'blocked' ? 'permission-blocked' : 'permission-denied');
    }

    const stream = await rtc.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user', width: 1280, height: 720 } : false,
    });
    stream.getTracks().forEach((t: any) => conn.addTrack(t, stream));
    set({ localStream: stream });
    return conn;
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
      } else if (goodStreak >= 5 && autoLevel !== 'high') {
        autoLevel = autoLevel === 'low' ? 'medium' : 'high';
        goodStreak = 0;
        void applyVideoPreset(autoLevel);
      }
    }, STATS_INTERVAL_MS);
  }

  function startAudioSession(kind: CallKind, ringback: boolean) {
    const icm = getInCallManager();
    if (!icm) return;
    try {
      icm.start({ media: kind, ringback: ringback ? '_DEFAULT_' : '' });
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
            chatWS.sendCall(msg.chat_id, 'busy', msg.call_id, msg.kind ?? 'audio');
          }
          return;
        }
        if (s.status !== 'idle') return; // duplicate offer for same call
        pendingOffer = msg.payload;
        pendingIce = [];
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
        clearTimers();
        set({ status: 'connecting' });
        try {
          await pc.setRemoteDescription(new rtc.RTCSessionDescription(msg.payload as any));
          for (const c of pendingIce) {
            try { await pc.addIceCandidate(new rtc.RTCIceCandidate(c)); } catch {}
          }
          pendingIce = [];
        } catch {
          teardown('failed', 'failed');
        }
        break;
      }

      case 'ice': {
        if (s.callId !== msg.call_id) return;
        const rtc = getWebRTC();
        if (!rtc || !msg.payload) return;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(new rtc.RTCIceCandidate(msg.payload as any)); } catch {}
        } else {
          // Candidates can arrive before the answer/accept — buffer them.
          pendingIce.push(msg.payload);
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
      const rtc = getWebRTC();
      if (!rtc) return false;

      const callId = newCallId();
      set({
        status: 'outgoing', callId, chatId, kind, isCaller: true, peer,
        endReason: null, isCameraOn: true, isMuted: false,
      });

      try {
        pc = await createPeerConnection(kind);
        if (!pc) throw new Error('no webrtc');
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        const sent = chatWS.sendCall(chatId, 'offer', callId, kind, pc.localDescription);
        if (!sent) throw new Error('ws closed');
      } catch (e) {
        teardown(permissionReason(e) ?? 'failed');
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
      const rtc = getWebRTC();
      if (!rtc) { teardown('failed'); return; }

      clearTimers();
      const icm = getInCallManager();
      try { icm?.stopRingtone(); } catch {}
      Vibration.cancel();
      set({ status: 'connecting' });

      try {
        pc = await createPeerConnection(kind);
        if (!pc) throw new Error('no webrtc');
        await pc.setRemoteDescription(new rtc.RTCSessionDescription(pendingOffer));
        pendingOffer = null;
        for (const c of pendingIce) {
          try { await pc.addIceCandidate(new rtc.RTCIceCandidate(c)); } catch {}
        }
        pendingIce = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        chatWS.sendCall(chatId, 'answer', callId, kind, pc.localDescription);
        startAudioSession(kind, false);
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
        void applyVideoPreset(q);
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
