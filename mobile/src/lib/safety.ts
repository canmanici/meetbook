import * as Location from 'expo-location';

let subscription: Location.LocationSubscription | null = null;

export async function startSafetyMode(exchangeId: string, meetupTime: Date): Promise<void> {
  // Request background location permission
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Background location permission denied');

  // Start watching position every 60s
  subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 60000 },
    (location) => {
      // Send to backend (placeholder — no API yet)
      console.log('[safety] location update', exchangeId, location.coords);
    }
  );

  // Auto-stop 30 min after meetup time
  const stopTime = new Date(meetupTime.getTime() + 30 * 60000);
  const msUntilStop = stopTime.getTime() - Date.now();
  if (msUntilStop > 0) {
    setTimeout(() => stopSafetyMode(), msUntilStop);
  }
}

export function stopSafetyMode(): void {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
}

export function isSafetyModeActive(): boolean {
  return subscription !== null;
}
