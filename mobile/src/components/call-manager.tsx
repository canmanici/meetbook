/**
 * Global call orchestrator — mounted once in the root layout.
 *
 * Binds WebRTC signaling to the chat WebSocket and navigates to /call
 * whenever a call starts (incoming or outgoing), regardless of which screen
 * the user is on. Renders nothing.
 */
import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';

import { useCallStore } from '@/stores/call-store';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import { chatWS } from '@/lib/api/chat';
import { markNotificationsRead } from '@/lib/api/client';
import { queryClient } from '@/lib/query-client';

/** MeetBook was opened while a call rings in the native notification (the
 * user tapped Cevapla on the lock-screen call screen, or just opened the
 * app). Show the in-app incoming-call screen right away, apply an Answer /
 * Decline that was tapped natively, and only then silence the notification.
 * Without a tapped action the notification keeps ringing — it holds the
 * Answer/Decline buttons if the user leaves the app again. */
async function takeOverRingingNotification(): Promise<void> {
  const cn = await import('@/lib/call-notification');
  const shown = await cn.getDisplayedIncomingCall();
  const call = useCallStore.getState();
  if (shown && call.status === 'idle') {
    call.prepareIncoming({
      callId: shown.callId,
      chatId: shown.chatId,
      kind: shown.kind,
      callerName: shown.callerName,
      callerAvatarUrl: shown.callerAvatarUrl,
      ring: false,
    });
  }
  const current = useCallStore.getState();
  if (current.status !== 'incoming' || !current.callId) return;
  const action = await cn.takePendingCallAction(current.callId);
  if (action === 'answer') await useCallStore.getState().acceptCall();
  else if (action === 'decline') useCallStore.getState().rejectCall();
}

const FSI_PROMPT_KEY = 'call_fsi_prompted_at';
const XIAOMI_PROMPT_KEY = 'call_xiaomi_lock_prompted';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Without these permissions a call on a locked phone only rings — the
 * screen stays black. Ask (sparingly) and deep-link to the right page. */
async function promptCallPermissionsIfNeeded(): Promise<void> {
  const m = await import('../../modules/incoming-call');
  if (!m.isIncomingCallNativeAvailable) return;
  try {
    if (!m.canUseFullScreenIntent()) {
      const last = Number(await AsyncStorage.getItem(FSI_PROMPT_KEY)) || 0;
      if (Date.now() - last < WEEK_MS) return;
      await AsyncStorage.setItem(FSI_PROMPT_KEY, String(Date.now()));
      Alert.alert(
        'Aramalar kilit ekranında görünsün',
        'Telefonun kilitliyken gelen aramaların tam ekran açılması için MeetBook’a “Tam ekran bildirim” izni ver.',
        [
          { text: 'Sonra', style: 'cancel' },
          { text: 'Ayarları aç', onPress: () => m.openFullScreenIntentSettings() },
        ],
      );
      return;
    }
    if (m.isXiaomiDevice() && !(await AsyncStorage.getItem(XIAOMI_PROMPT_KEY))) {
      await AsyncStorage.setItem(XIAOMI_PROMPT_KEY, '1');
      Alert.alert(
        'Xiaomi: kilit ekranı izni',
        'Xiaomi telefonlarda aramaların kilit ekranında açılması için “Kilit ekranında göster” ve “Arka planda açılır pencereler” izinlerini aç.',
        [
          { text: 'Sonra', style: 'cancel' },
          { text: 'İzinleri aç', onPress: () => m.openXiaomiPermissions() },
        ],
      );
    }
  } catch {}
}

export function CallManager() {
  const router = useRouter();
  const pathname = usePathname();
  const status = useCallStore((s) => s.status);
  const bindSignaling = useCallStore((s) => s.bindSignaling);
  const authStatus = useAuthStore((s) => s.status);
  const wasInCall = useRef(false);

  useEffect(() => {
    bindSignaling();
  }, [bindSignaling]);

  // Keep the WS alive while authenticated so incoming call offers reach us
  // even when no chat screen is mounted; tear it down on logout so the old
  // user's socket doesn't keep receiving events.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      useChatStore.getState().connect();
    } else if (authStatus === 'unauthenticated') {
      useChatStore.getState().disconnect();
    }
  }, [authStatus]);

  // Doze/backgrounding kills the socket silently; reconnect the moment the
  // app foregrounds (incl. via an incoming-call push tap) so the backend's
  // ring grace window can re-deliver a pending call offer.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useAuthStore.getState().status === 'authenticated') {
        chatWS.connect();
      }
      // App came to the front mid-ring (full-screen launch / tap): open the
      // call screen from the notification right away, then stop the
      // notification's looping ringtone — the in-app screen rings now.
      if (state === 'active') void takeOverRingingNotification();
    });
    return () => sub.remove();
  }, []);

  // Push notifications: foreground display, live bell refresh, and taps
  // (routed like the in-app list, marking the bell entry read).
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const unsubs: (() => void)[] = [];
    let cancelled = false;
    const refreshBell = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void import('@/lib/push-tokens').then(async (m) => {
      const subs = await Promise.all([
        m.initNotifications(refreshBell),
        m.listenForNotificationTaps(
          (href) => router.push(href as never),
          () => useCallStore.getState().status !== 'idle',
          (notificationId) => {
            if (!notificationId) return;
            markNotificationsRead({ notification_ids: [notificationId] })
              .catch(() => {})
              .finally(refreshBell);
          },
        ),
      ]);
      if (cancelled) subs.forEach((u) => u());
      else unsubs.push(...subs);
    });
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authStatus, router]);

  // Launched/resumed from the call notification: move the call into the app.
  // Also keep the native Decline button's token fresh while logged in.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void takeOverRingingNotification();
    void import('@/lib/call-notification').then((m) => m.syncCallAuth());
    // Declined on the notification / lock-screen call screen while the app
    // (and its socket) is alive: drop our own ringing state as well.
    let removeListener: (() => void) | null = null;
    void import('../../modules/incoming-call').then((m) => {
      removeListener = m.addCallActionListener(({ callId, action }) => {
        const c = useCallStore.getState();
        if (action === 'decline' && c.status === 'incoming' && c.callId === callId) c.rejectCall();
      });
    });
    // Give the home screen a moment before any permission dialog.
    const t = setTimeout(() => void promptCallPermissionsIfNeeded(), 4000);
    return () => {
      clearTimeout(t);
      removeListener?.();
    };
  }, [authStatus]);

  useEffect(() => {
    const inCall = status !== 'idle';
    if (inCall && !wasInCall.current && pathname !== '/call') {
      // Cast: expo-router's generated route types are only refreshed on the
      // next `expo start`, so the brand-new /call route isn't in them yet.
      router.push('/call' as never);
    }
    wasInCall.current = inCall;
  }, [status, pathname, router]);

  return null;
}
