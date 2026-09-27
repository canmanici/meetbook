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
 * they aren't buried like an ordinary message notification. Everything else
 * uses 'default' (the backend always sends a channelId).
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await getNotifications();
  if (!Notifications?.setNotificationChannelAsync) return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Bildirimler',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
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
 * Foreground behaviour + live bell refresh. Without a handler expo drops
 * every push that arrives while the app is open (the backend only skips the
 * push for users with a live socket, so a backgrounded-but-connected app
 * could lose them). `onReceived` lets the caller refetch the bell list.
 * Returns an unsubscribe function.
 */
export async function initNotifications(onReceived: () => void): Promise<() => void> {
  const Notifications = await getNotifications();
  if (!Notifications?.setNotificationHandler) return () => {};
  await ensureNotificationChannels();
  Notifications.setNotificationHandler({
    handleNotification: async (notification: any) => {
      const data = notification?.request?.content?.data ?? {};
      // Ringing is handled by the in-app call screen once the socket is up.
      const silent = data.type === 'incoming_call';
      return {
        shouldShowBanner: !silent,
        shouldShowList: !silent,
        shouldShowAlert: !silent,
        shouldPlaySound: !silent,
        shouldSetBadge: false,
      };
    },
  });
  const sub = Notifications.addNotificationReceivedListener?.(() => onReceived());
  return () => sub?.remove?.();
}

/**
 * Routes notification taps to the same screen the in-app list would open
 * (see notification-routing.ts) and marks the matching bell entry read.
 * An incoming-call push only needs the app foregrounded (CallManager
 * reconnects the socket and the backend re-delivers the ringing offer) — if
 * that window has passed, fall back to the chat so the user can call back.
 * Returns an unsubscribe function.
 */
let lastHandledTapId: string | null = null;

export async function listenForNotificationTaps(
  navigate: (href: string) => void,
  isCallInProgress: () => boolean,
  onOpened: (notificationId: string | null) => void,
): Promise<() => void> {
  const Notifications = await getNotifications();
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  const { hrefForNotification } = await import('./notification-routing');
  const handle = (response: any) => {
    // getLastNotificationResponseAsync keeps returning the same tap on every
    // re-subscribe (re-login, remount) — route each tap only once.
    const id = response?.notification?.request?.identifier;
    if (id) {
      if (id === lastHandledTapId) return;
      lastHandledTapId = id;
    }
    const data = response?.notification?.request?.content?.data ?? {};
    const type = typeof data.type === 'string' ? data.type : '';
    onOpened(typeof data.notification_id === 'string' ? data.notification_id : null);
    // Informational pushes (broadcast, report result) open the bell list.
    const href = hrefForNotification(type, data) ?? '/notifications';
    if (type === 'incoming_call') {
      // Give the re-delivered offer a moment to arrive before falling back.
      setTimeout(() => {
        if (!isCallInProgress()) navigate(href);
      }, 4000);
    } else {
      navigate(href);
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

/**
 * Register this device's Expo push token for the logged-in user.
 * `prompt: false` (app restart) only re-registers when permission was already
 * granted — it never pops the OS dialog on launch.
 *
 * Always POSTs, even for an unchanged token: the call is idempotent, and a
 * local "already registered" cache skipped re-registration after switching
 * accounts or after the backend pruned the token.
 */
export async function registerPushToken({ prompt = true }: { prompt?: boolean } = {}): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) return false;
  await ensureNotificationChannels();

  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted' && prompt) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

    // Standalone builds need the EAS projectId (app.json extra.eas.projectId).
    const Constants = (await import('expo-constants')).default;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const { data: expoToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!expoToken) return false;

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

/**
 * Detach this device from the account on logout. `accessToken` must be the
 * token from BEFORE the session was cleared — reading it from the store at
 * call time sent the DELETE unauthenticated, so the logged-out user kept
 * receiving pushes on this phone.
 */
export async function unregisterPushToken(accessToken: string | null): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
    if (token && accessToken) {
      await apiClient
        .delete(`/auth/push-token?token=${encodeURIComponent(token)}`, accessToken)
        .catch(() => {});
    }
    await AsyncStorage.removeItem(REGISTERED_TOKEN_KEY);
  } catch {}
}
