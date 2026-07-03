import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BIOMETRIC_LOCK_KEY = '@meetbook_biometric_lock_enabled';

/**
 * Hardware + enrollment check — a device can have the sensor but no
 * fingerprint/face registered, in which case authenticateAsync would just
 * fail every time, so the toggle should stay hidden/disabled instead.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return isEnrolled;
  } catch {
    return false;
  }
}

export async function getBiometricTypeLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'Face ID';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'Parmak İzi';
    }
    return 'Biyometrik Kilit';
  } catch {
    return 'Biyometrik Kilit';
  }
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BIOMETRIC_LOCK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await AsyncStorage.setItem(BIOMETRIC_LOCK_KEY, '1');
    } else {
      await AsyncStorage.removeItem(BIOMETRIC_LOCK_KEY);
    }
  } catch {
    // best-effort — worst case the toggle doesn't persist across restarts
  }
}

export async function authenticateWithBiometrics(reason: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'İptal',
      disableDeviceFallback: false, // allow device passcode as a fallback
    });
    return result.success;
  } catch {
    return false;
  }
}
