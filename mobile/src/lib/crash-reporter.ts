/**
 * CrashReporter — best-effort crash submission.
 *
 * Strategy (3 layers deep):
 *   1. POST to backend  (10s timeout, abort-safe)
 *   2. AsyncStorage     (offline queue, max 20)
 *   3. console.warn     (visible in `adb logcat` on Android)
 *
 * No import of native modules that could fail in Expo Go.
 * Self-healing: when a crash IS sent, flush any pending from storage.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const CRASH_ENDPOINT = `${API_URL}/crash-report`;
const PENDING_CRASHES_KEY = 'pending_crashes';

interface Breadcrumb {
  action: string;
  label: string;
  timestamp: string;
  data?: Record<string, unknown> | null;
}

interface DeviceInfo {
  platform: string;
  os_version: string;
  model: string | null;
  app_version: string | null;
  memory_mb: number | null;
  is_emulator: boolean;
}

interface CrashPayload {
  app: string;
  app_version: string | null;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  breadcrumbs: Breadcrumb[];
  device_info: DeviceInfo | null;
  screen_name: string | null;
  user_id: string | null;
}

class CrashReporter {
  private breadcrumbs: Breadcrumb[] = [];
  private currentScreen: string | null = null;
  private currentUserId: string | null = null;
  private initialized = false;
  private readonly MAX_BREADCRUMBS = 50;
  private readonly SEND_TIMEOUT_MS = 10_000;

  /** Record user actions for crash context. Call from navigation and API wrappers. */
  addBreadcrumb(action: string, label: string, data?: Record<string, unknown>) {
    if (!this.initialized) return;
    this.breadcrumbs.push({
      action,
      label,
      timestamp: new Date().toISOString(),
      data: data ?? null,
    });
    if (this.breadcrumbs.length > this.MAX_BREADCRUMBS) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.MAX_BREADCRUMBS);
    }
  }

  /** Set the current screen name. Call from navigation listener. */
  setCurrentScreen(name: string) {
    if (!this.initialized) return;
    this.currentScreen = name;
    this.addBreadcrumb('navigate', `Screen: ${name}`);
  }

  /** Set the current user. Call after successful login / from auth state. */
  setUser(userId: string | null) {
    this.currentUserId = userId;
  }

  /** Build device metadata once at init. */
  private buildDeviceInfo(): DeviceInfo {
    return {
      platform: Platform.OS,
      os_version: String(Platform.Version),
      model: Device.modelName ?? null,
      app_version: Constants.expoConfig?.version ?? null,
      memory_mb: null,
      is_emulator: !Device.isDevice,
    };
  }

  /**
   * Layer 1: POST crash to backend.
   * Returns true if the server accepted the payload (HTTP 2xx).
   */
  private async send(payload: CrashPayload): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.SEND_TIMEOUT_MS);
      const res = await fetch(CRASH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch (err) {
      // Network error or timeout — caller will fall back to storage
      console.warn('[CrashReporter] send() failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Layer 2: persist crash to AsyncStorage for retry on next launch.
   */
  private async savePending(payload: CrashPayload) {
    try {
      const raw = await AsyncStorage.getItem(PENDING_CRASHES_KEY);
      const pending: CrashPayload[] = raw ? JSON.parse(raw) : [];
      pending.push(payload);
      await AsyncStorage.setItem(
        PENDING_CRASHES_KEY,
        JSON.stringify(pending.slice(-20)),
      );
      console.warn('[CrashReporter] saved to AsyncStorage (pending:', pending.length, ')');
    } catch {
      // Layer 3: nothing works — log to console (visible in adb logcat)
      console.warn('[CrashReporter] AsyncStorage also failed. Crash lost:', JSON.stringify({
        error_type: payload.error_type,
        error_message: payload.error_message,
      }));
    }
  }

  /** Retry sending any crashes saved for later. */
  async flushPending() {
    try {
      const raw = await AsyncStorage.getItem(PENDING_CRASHES_KEY);
      if (!raw) return;
      const pending: CrashPayload[] = JSON.parse(raw);
      const remaining: CrashPayload[] = [];
      for (const crash of pending) {
        const sent = await this.send(crash);
        if (!sent) remaining.push(crash);
      }
      if (remaining.length === 0) {
        await AsyncStorage.removeItem(PENDING_CRASHES_KEY);
        console.warn('[CrashReporter] flushed all pending crashes');
      } else {
        await AsyncStorage.setItem(PENDING_CRASHES_KEY, JSON.stringify(remaining));
        console.warn('[CrashReporter]', remaining.length, 'crashes still pending');
      }
    } catch {
      // silently fail
    }
  }

  /** Known false-positive error patterns — skip these silently. */
  private _isKnownFalsePositive(errorMessage: string): boolean {
    const patterns = [
      // react-native-webrtc native module not linked in this build.
      // This is caught safely by the lazy loader and doesn't crash the app.
      'WebRTC native module not found',
    ];
    return patterns.some((p) => errorMessage.includes(p));
  }

  /** Report a caught error. Use in try-catch blocks and error boundaries. */
  async captureError(error: unknown, context?: string) {
    if (!this.initialized) {
      console.warn('[CrashReporter] captureError called before initialize()');
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));

    // Filter known false positives that don't actually crash the app
    if (this._isKnownFalsePositive(err.message)) {
      if (__DEV__) {
        console.log('[CrashReporter] skipping known false-positive:', err.message);
      }
      return;
    }

    const payload: CrashPayload = {
      app: 'mobile',
      app_version: Constants.expoConfig?.version ?? null,
      error_type: context ?? err.name,
      error_message: err.message || String(error),
      stack_trace: err.stack ?? null,
      breadcrumbs: [...this.breadcrumbs],
      device_info: this.buildDeviceInfo(),
      screen_name: this.currentScreen,
      user_id: this.currentUserId,
    };

    // Log to console immediately (visible in logcat on Android)
    console.warn('[CrashReporter] capturing:', payload.error_type, payload.error_message);
    console.warn('[CrashReporter] endpoint:', CRASH_ENDPOINT);

    // Layer 1: try backend
    const sent = await this.send(payload);
    if (sent) {
      console.warn('[CrashReporter] sent successfully');
      // Opportunistic flush of any pending crashes
      this.flushPending().catch(() => {});
      return;
    }

    // Layer 2: save for later
    await this.savePending(payload);
  }

  /** Initialize: hook into global error handler + set up. */
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    console.warn('[CrashReporter] initialized. Endpoint:', CRASH_ENDPOINT);

    // Capture unhandled JS errors
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      this.captureError(error, isFatal ? 'UnhandledFatal' : 'Unhandled');
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });

    // Flush any crashes saved from previous session
    this.flushPending();

    if (__DEV__) {
      console.log('[CrashReporter] ready');
    }
  }
}

// Singleton — module-level, imported once
export const crashReporter = new CrashReporter();
export default crashReporter;
