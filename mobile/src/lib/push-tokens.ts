import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/lib/api/client';

const REGISTERED_TOKEN_KEY = 'registered_push_token';

// Lazy getter — Metro evaluates module-level require() eagerly even inside
// try-catch, and expo-notifications logs an ERROR overlay in Expo Go that
// blocks the app.  Loading on first use avoids the problem entirely.
let _Notifications: any | null = null;
let _loadAttempted = false;
async function getNotifications(): Promise<any | null> {
  if (_loadAttempted) return _Notifications;
  _loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require avoids expo-notifications Expo Go error overlay
    _Notifications = require('expo-notifications');
  } catch {
    console.log('[Push] expo-notifications not available (Expo Go?)');
  }
  return _Notifications;
}

/**
 * Android notification channels. Incoming-call pushes go to a dedicated
 * max-importance 'calls' channel (heads-up, lock screen, long vibration) so
 * they aren't buried like an ordinary message notification.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await getNotifications();
  if (!Notifications?.setNotificationChannelAsync) return;
  try {
    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Aramalar',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 800, 1200, 800, 1200, 800],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
    });
  } catch (err) {
    console.warn('[Push] Channel setup failed:', err);
  }
}

/**
 * Routes notification taps: a message push opens its chat; an incoming-call
 * push only needs the app foregrounded (CallManager reconnects the socket and
 * the backend re-delivers the ringing offer) — if that window has passed,
 * fall back to the chat so the user can call back.
 * Returns an unsubscribe function.
 */
let lastHandledTapId: string | null = null;

export async function listenForNotificationTaps(
  openChat: (exchangeId: string) => void,
  isCallInProgress: () => boolean,
): Promise<() => void> {
  const Notifications = await getNotifications();
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  const handle = (response: any) => {
    // getLastNotificationResponseAsync keeps returning the same tap on every
    // re-subscribe (re-login, remount) — route each tap only once.
    const id = response?.notification?.request?.identifier;
    if (id) {
      if (id === lastHandledTapId) return;
      lastHandledTapId = id;
    }
    const data = response?.notification?.request?.content?.data ?? {};
    const exchangeId = typeof data.exchange_id === 'string' ? data.exchange_id : null;
    if (!exchangeId) return;
    if (data.type === 'incoming_call') {
      // Give the re-delivered offer a moment to arrive before falling back.
      setTimeout(() => {
        if (!isCallInProgress()) openChat(exchangeId);
      }, 4000);
    } else if (data.type === 'new_message') {
      openChat(exchangeId);
    }
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  // Cold start: the tap that launched the app fired before we subscribed.
  try {
    const last = await Notifications.getLastNotificationResponseAsync?.();
    if (last) handle(last);
  } catch {}
  return () => sub.remove();
}

export async function registerPushToken(): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) return false;
  await ensureNotificationChannels();

  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

    const { data: expoToken } = await Notifications.getExpoPushTokenAsync();
    if (!expoToken) return false;

    const lastToken = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
    if (lastToken === expoToken) {
      console.log('[Push] Token already registered');
      return true;
    }

    const res = await apiClient.post('/auth/push-token', {
      token: expoToken,
      platform: Platform.OS,
      device_id: null,
    });

    if (res.ok) {
      await AsyncStorage.setItem(REGISTERED_TOKEN_KEY, expoToken);
      console.log('[Push] Token registered with backend');
      return true;
    }

    console.warn('[Push] Backend rejected token registration');
    return false;
  } catch (err) {
    console.warn('[Push] Token registration failed:', err);
    return false;
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
    if (token) {
      await apiClient.delete(`/auth/push-token?token=${encodeURIComponent(token)}`).catch(() => {});
    }
    await AsyncStorage.removeItem(REGISTERED_TOKEN_KEY);
  } catch {}
}
