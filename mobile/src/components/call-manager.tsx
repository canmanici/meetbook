/**
 * Global call orchestrator — mounted once in the root layout.
 *
 * Binds WebRTC signaling to the chat WebSocket and navigates to /call
 * whenever a call starts (incoming or outgoing), regardless of which screen
 * the user is on. Renders nothing.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'expo-router';

import { useCallStore } from '@/stores/call-store';
import { useAuthStore } from '@/stores/auth-store';
import { chatWS } from '@/lib/api/chat';

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
  // even when no chat screen is mounted.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      chatWS.connect();
    }
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
