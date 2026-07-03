import * as Location from 'expo-location';
import { updateLocation, stopLocationSharing, type LocationPrecision } from '@/lib/api/client';

/**
 * "Nerdeyim Modu" device-side sender.
 *
 * Design (v2 — rebuilt after the watchPositionAsync-based version kept
 * silently dying): sharing is an explicit *session*, not a side effect of a
 * GPS subscription. A 30s heartbeat interval calls sendOneLocation(), which
 * already falls back cache → balanced → high; if the device can't produce a
 * fix this tick, the next tick retries. The session stays alive regardless —
 * the old version derived "am I sharing" from whether watchPositionAsync
 * succeeded, so one transient GPS hiccup at start permanently flipped every
 * screen back to "not sharing".
 *
 * The *authoritative* sharing state lives server-side (the Redis loc: key,
 * exposed via GET /exchanges/{id}/location/status). This module only answers
 * "is this device currently trying to share, and to which exchange".
 */

const HEARTBEAT_MS = 30_000;

interface SafetySession {
  exchangeId: string;
  heartbeat: ReturnType<typeof setInterval>;
  autoStop: ReturnType<typeof setTimeout> | null;
}

let session: SafetySession | null = null;
let currentPrecision: LocationPrecision = 'exact';
let anyFixSent = false;
let sendCount = 0;
let lastSentLocation: { latitude: number; longitude: number } | null = null;

/** Last coordinates this device successfully sent to the backend, or null. */
export function getLastSentLocation(): { latitude: number; longitude: number } | null {
  return lastSentLocation;
}

/**
 * Custom error thrown when safety mode can't start due to
 * missing background location permission.
 */
export class SafetyPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyPermissionError';
  }
}

/** Whether any location fix actually reached the backend this session. */
export function hasSentAnyLocationFix(): boolean {
  return anyFixSent;
}

/**
 * Try to get a location and send it to the backend.
 * Never blocks more than a few seconds.
 *
 * Priority:
 *   1. Last-known position from cache (instant, works offline)
 *   2. Current position via network/wifi (5s timeout)
 *   3. High-accuracy upgrade in the background (exact precision only)
 */
async function sendOneLocation(exchangeId: string, label: string): Promise<void> {
  // Try 1: cached position — fastest, works even without GPS/network
  try {
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 600_000 });
    if (cached) {
      await updateLocation(exchangeId, {
        latitude: cached.coords.latitude,
        longitude: cached.coords.longitude,
        precision: currentPrecision,
      });
      anyFixSent = true;
      sendCount++;
      lastSentLocation = { latitude: cached.coords.latitude, longitude: cached.coords.longitude };
      console.log(
        `[safety] ${label}: cached (${cached.coords.latitude.toFixed(4)}, ${cached.coords.longitude.toFixed(4)})`,
      );
      // Fall through intent: a cached fix may be stale — still try to upgrade
      // to a fresh one in the background so the partner sees movement.
      if (currentPrecision !== 'approximate') {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(async (fresh) => {
            await updateLocation(exchangeId, {
              latitude: fresh.coords.latitude,
              longitude: fresh.coords.longitude,
              precision: currentPrecision,
            });
            sendCount++;
            lastSentLocation = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
          })
          .catch(() => undefined);
      }
      return;
    }
  } catch {
    // cache unavailable, try fresh
  }

  // Try 2: Balanced — works with WiFi/cell, returns in <5s
  let balancedPos: Location.LocationObject | null = null;
  try {
    balancedPos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<Location.LocationObject | null>((resolve) =>
        setTimeout(() => resolve(null), 5000),
      ),
    ]);
  } catch {
    balancedPos = null;
  }

  if (balancedPos) {
    await updateLocation(exchangeId, {
      latitude: balancedPos.coords.latitude,
      longitude: balancedPos.coords.longitude,
      precision: currentPrecision,
    });
    anyFixSent = true;
    sendCount++;
    lastSentLocation = { latitude: balancedPos.coords.latitude, longitude: balancedPos.coords.longitude };
    console.log(
      `[safety] ${label}: balanced (${balancedPos.coords.latitude.toFixed(4)}, ${balancedPos.coords.longitude.toFixed(4)})`,
    );
    return;
  }

  console.warn(`[safety] ${label}: no location available (will retry next heartbeat)`);
}

/**
 * Activates safety mode: requests background location permission, sends the
 * current position immediately, then re-sends every 30 seconds.
 *
 * Auto-stops 30 minutes after the scheduled meetup time.
 *
 * Throws SafetyPermissionError if background location permission is denied.
 * Any *other* failure (no GPS fix, flaky network) does NOT kill the session —
 * the heartbeat keeps retrying.
 */
export async function startSafetyMode(
  exchangeId: string,
  meetupTime: Date,
  precision: LocationPrecision = 'exact',
): Promise<void> {
  currentPrecision = precision;

  // Already sharing to this exchange → no-op; to another → switch cleanly.
  if (session?.exchangeId === exchangeId) return;
  if (session) stopSafetyMode();

  // Step 1: Check & request background location permission
  let granted = false;
  try {
    const { status: initialStatus } = await Location.getBackgroundPermissionsAsync();
    if (initialStatus === 'granted') {
      granted = true;
    } else {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      granted = status === 'granted';
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    throw new SafetyPermissionError(
      `Arka plan konum izni alınamadı.\n(${message})\n\n` +
      `Ayarlar > Uygulamalar > MeetBook > Konum bölümünden "Her Zaman" seçeneğini etkinleştirmeyi deneyin.`,
    );
  }

  if (!granted) {
    throw new SafetyPermissionError(
      'Arka plan konum izni reddedildi.\n\n' +
      'Ayarlar > Uygulamalar > MeetBook > Konum bölümünden "Her Zaman" seçeneğini etkinleştirin.',
    );
  }

  // Step 2: The session exists from this point on — fix acquisition failures
  // are retried by the heartbeat, they never tear the session down.
  anyFixSent = false;
  sendCount = 0;

  const heartbeat = setInterval(() => {
    if (!session) return;
    sendOneLocation(session.exchangeId, `heartbeat#${sendCount + 1}`).catch((err) =>
      console.warn('[safety] heartbeat send failed:', err),
    );
  }, HEARTBEAT_MS);

  // Step 3: Auto-stop 30 min after scheduled meetup (only if in the future)
  const msUntilStop = meetupTime.getTime() + 30 * 60_000 - Date.now();
  const autoStop = msUntilStop > 0 ? setTimeout(() => stopSafetyMode(), msUntilStop) : null;

  session = { exchangeId, heartbeat, autoStop };

  // Fire the first fix without blocking the caller (UI responds instantly).
  sendOneLocation(exchangeId, 'initial').catch((err) =>
    console.warn('[safety] initial send failed:', err),
  );
}

/**
 * Stops safety mode — clears the heartbeat and tells the backend to clear
 * the stored location immediately (instead of waiting out the TTL), so the
 * partner sees "stopped" in real time rather than a stale pin.
 */
export function stopSafetyMode(): void {
  if (!session) return;
  clearInterval(session.heartbeat);
  if (session.autoStop) clearTimeout(session.autoStop);
  const { exchangeId } = session;
  session = null;
  stopLocationSharing(exchangeId).catch(() => {
    // best-effort — the Redis TTL will still expire the key eventually
  });
  console.log(`[safety] stopped (${sendCount} updates sent)`);
}

/**
 * Updates the precision used for subsequent location sends without
 * restarting the session.
 */
export function setSafetyPrecision(precision: LocationPrecision): void {
  currentPrecision = precision;
}

/** Whether a sharing session is currently active on this device. */
export function isSafetyModeActive(): boolean {
  return session !== null;
}

/**
 * The exchange currently being shared to from this device, or null.
 * Server-side status (GET /location/status) remains the authoritative
 * cross-device answer; this covers the local session only.
 */
export function getActiveSharingExchangeId(): string | null {
  return session?.exchangeId ?? null;
}
