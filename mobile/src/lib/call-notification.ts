/**
 * Incoming-call notification for a backgrounded or killed app — a native
 * Android CallStyle notification (modules/incoming-call): system Answer /
 * Decline buttons, full-screen on a locked phone, looping ringtone at ring
 * volume that stops by itself when the caller's ring window ends.
 *
 * Flow:
 *   backend → data-only push {type:'incoming_call', expires_at} → background
 *   task (background-handlers.ts) → showIncomingCall()
 *   - Decline: handled NATIVELY (DeclineReceiver → POST /chat/calls/decline),
 *     so it works with no JS runtime at all.
 *   - Answer: opens the app; the tap is recorded natively and the call store
 *     accepts the call once the offer arrives over the socket.
 *   - Caller hangs up early: data push {type:'call_cancelled'} → cancel.
 *
 * Everything degrades to a no-op where the native module is absent (Expo Go,
 * web, Jest).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  cancelNativeIncomingCall,
  getNativeActiveCall,
  setNativeCallAuth,
  showNativeIncomingCall,
  takeNativePendingAction,
} from '../../modules/incoming-call';

const PENDING_KEY = 'pending_call_action';
const DEFAULT_RING_MS = 30_000;

export type IncomingCallInfo = {
  callId: string;
  chatId: string;
  exchangeId?: string | null;
  kind: 'audio' | 'video';
  callerName: string;
  /** Caller's profile photo (static or animated GIF), absolute URL. */
  callerAvatarUrl?: string | null;
  /** Epoch ms when the caller stops ringing (from the push). */
  expiresAt?: number;
};

export type PendingCallAction = { callId: string; action: 'answer' | 'decline'; at: number };

export async function showIncomingCall(info: IncomingCallInfo, opts: { quiet?: boolean } = {}): Promise<void> {
  showNativeIncomingCall(
    {
      callId: info.callId,
      chatId: info.chatId,
      kind: info.kind,
      callerName: info.callerName,
      callerAvatarUrl: info.callerAvatarUrl ?? '',
      expiresAt: info.expiresAt ?? Date.now() + DEFAULT_RING_MS,
    },
    opts.quiet ?? false,
  );
}

export async function cancelIncomingCall(callId: string | null | undefined): Promise<void> {
  if (callId) cancelNativeIncomingCall(callId);
}

/** The call ringing in the notification right now, if any — lets the app
 * open its call screen the instant it launches, before the socket is up. */
export async function getDisplayedIncomingCall(): Promise<IncomingCallInfo | null> {
  const active = getNativeActiveCall();
  return active
    ? { ...active, exchangeId: null, callerAvatarUrl: active.callerAvatarUrl || null }
    : null;
}

/** Give the native Decline button a fresh token (access tokens live 15 min). */
export async function syncCallAuth(): Promise<void> {
  try {
    const { useAuthStore } = await import('@/stores/auth-store');
    const { API_BASE_URL, getMe } = await import('@/lib/api/client');
    if (!useAuthStore.getState().accessToken) await useAuthStore.getState().bootstrap();
    // Any authed call refreshes an expired access token as a side effect.
    await getMe().catch(() => {});
    const token = useAuthStore.getState().accessToken;
    if (token) setNativeCallAuth(API_BASE_URL, token);
  } catch {}
}

// ── Answer/Decline tapped before the call reached the store ──────────────
// JS-side memory + storage, merged with what native code recorded (the
// notification buttons and the full-screen launch are handled natively).

let pendingAction: PendingCallAction | null = null;
const PENDING_TTL_MS = 60_000;

export async function setPendingCallAction(callId: string, action: 'answer' | 'decline'): Promise<void> {
  pendingAction = { callId, action, at: Date.now() };
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pendingAction));
  } catch {}
}

/** Returns and clears the remembered action for this call, if still fresh. */
export async function takePendingCallAction(callId: string): Promise<'answer' | 'decline' | null> {
  const fromNative = takeNativePendingAction();
  if (fromNative && fromNative.callId === callId) return fromNative.action;

  let p = pendingAction;
  if (!p || p.callId !== callId) {
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      p = raw ? (JSON.parse(raw) as PendingCallAction) : null;
    } catch {
      p = null;
    }
  }
  if (!p || p.callId !== callId || Date.now() - p.at > PENDING_TTL_MS) return null;
  pendingAction = null;
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
  return p.action;
}

/** Pull our call fields out of a push/notification data blob (any shape). */
export function parseCallData(raw: unknown): (Partial<IncomingCallInfo> & { type?: string }) | null {
  const candidates: unknown[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (v == null || depth > 4) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('{')) {
        try { visit(JSON.parse(t), depth + 1); } catch {}
      }
      return;
    }
    if (typeof v !== 'object') return;
    candidates.push(v);
    for (const key of ['data', 'body', 'dataString', 'notification', 'request', 'content', 'payload']) {
      visit((v as Record<string, unknown>)[key], depth + 1);
    }
  };
  visit(raw);
  const hit = candidates.find(
    (c) => typeof (c as any).type === 'string' && typeof (c as any).call_id === 'string',
  ) as Record<string, any> | undefined;
  if (!hit) return null;
  const expires = Number(hit.expires_at);
  return {
    type: hit.type,
    callId: hit.call_id,
    chatId: hit.chat_id,
    exchangeId: hit.exchange_id || null,
    kind: hit.kind === 'video' ? 'video' : 'audio',
    callerName: hit.caller_name || '',
    callerAvatarUrl: typeof hit.caller_avatar_url === 'string' ? hit.caller_avatar_url : null,
    expiresAt: Number.isFinite(expires) && expires > 0 ? expires : undefined,
  };
}
