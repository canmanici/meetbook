/**
 * Handlers that must run even when the app is killed — registered from the
 * entry file (index.js) BEFORE expo-router mounts, because a headless start
 * (data push) never renders the route tree.
 *
 * Data-only push (expo-notifications background task):
 *   incoming_call  → native ringing call notification (modules/incoming-call)
 *   call_cancelled → stop it
 * The notification's Answer/Decline buttons are handled natively — no JS
 * runtime is needed when they're tapped.
 */
import { Platform } from 'react-native';

import { cancelIncomingCall, parseCallData, showIncomingCall, syncCallAuth } from '@/lib/call-notification';

export const BACKGROUND_NOTIFICATION_TASK = 'meetbook-background-notification';

async function handleCallPush(raw: unknown): Promise<void> {
  const call = parseCallData(raw);
  if (!call?.callId) return;
  if (call.type === 'incoming_call' && call.chatId) {
    // Ring first (every ms counts), then refresh the token native Decline uses.
    await showIncomingCall({
      callId: call.callId,
      chatId: call.chatId,
      exchangeId: call.exchangeId,
      kind: call.kind ?? 'audio',
      callerName: call.callerName ?? '',
      callerAvatarUrl: (await import('@/lib/api/client')).absoluteMediaUrl(call.callerAvatarUrl),
      expiresAt: call.expiresAt,
    });
    await syncCallAuth();
  } else if (call.type === 'call_cancelled') {
    await cancelIncomingCall(call.callId);
  }
}

let registered = false;

export function registerBackgroundHandlers(): void {
  if (registered || Platform.OS !== 'android') return;
  registered = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native modules; absent in Expo Go/Jest
    const TaskManager = require('expo-task-manager');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }: { data: unknown; error: unknown }) => {
      if (error) return;
      await handleCallPush(data);
    });
    void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((err: unknown) =>
      console.warn('[background] registerTaskAsync failed:', err),
    );
  } catch {
    // Expo Go / web: no background task support.
  }
}
