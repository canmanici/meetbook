import * as Clipboard from 'expo-clipboard';
import { Linking, Platform } from 'react-native';

export interface MapLinks {
  google: string;
  yandex: string;
  apple: string;
}

/** Build deep-link URLs for a point, for the three map apps the DoD requires. */
export function buildMapLinks(lat: number, lng: number, label: string): MapLinks {
  const encodedLabel = encodeURIComponent(label);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    yandex: `https://yandex.com/maps/?pt=${lng},${lat}&z=16&text=${encodedLabel}`,
    apple: `https://maps.apple.com/?ll=${lat},${lng}&q=${encodedLabel}`,
  };
}

/**
 * Try opening the location in Google Maps, then Yandex Maps, then Apple Maps.
 * If none can be opened (e.g. simulator with no map apps), copies a
 * human-readable address to the clipboard and returns 'clipboard'.
 */
export async function openInMaps(
  lat: number,
  lng: number,
  label: string
): Promise<'google' | 'yandex' | 'apple' | 'clipboard'> {
  const links = buildMapLinks(lat, lng, label);
  const order: ['google' | 'yandex' | 'apple', string][] =
    Platform.OS === 'ios'
      ? [
          ['apple', links.apple],
          ['google', links.google],
          ['yandex', links.yandex],
        ]
      : [
          ['google', links.google],
          ['yandex', links.yandex],
          ['apple', links.apple],
        ];

  for (const [key, url] of order) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return key;
      }
    } catch {
      // try the next provider
    }
  }

  await Clipboard.setStringAsync(`${label} — ${lat}, ${lng}`);
  return 'clipboard';
}
