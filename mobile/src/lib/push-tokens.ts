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
    _Notifications = require('expo-notifications');
  } catch {
    console.log('[Push] expo-notifications not available (Expo Go?)');
  }
  return _Notifications;
}

export async function registerPushToken(): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) return false;

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
