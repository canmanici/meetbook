/**
 * Global call orchestrator — mounted once in the root layout.
 *
 * Binds WebRTC signaling to the chat WebSocket and navigates to /call
 * whenever a call starts (incoming or outgoing), regardless of which screen
 * the user is on. Renders nothing.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import { useCallStore } from '@/stores/call-store';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import { chatWS } from '@/lib/api/chat';
import { markNotificationsRead } from '@/lib/api/client';
import { queryClient } from '@/lib/query-client';

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
