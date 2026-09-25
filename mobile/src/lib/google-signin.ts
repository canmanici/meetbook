/**
 * Sign in with Google — lazy wrapper around @react-native-google-signin.
 *
 * The native module only exists in dev-client / release builds, so it is
 * required lazily (web, Expo Go and Jest get `null` and the button hides).
 * It is also hidden until EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is set: Google
 * issues the ID token for the WEB client ID, which the backend checks as the
 * token audience (GOOGLE_CLIENT_IDS).
 */
import { Platform } from 'react-native';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

let cached: GoogleModule | null | undefined;
let configured = false;

function load(): GoogleModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === 'web' || !WEB_CLIENT_ID) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function isGoogleSignInAvailable(): boolean {
  return load() !== null;
}

export class GoogleSignInError extends Error {
  constructor(public code: 'unavailable' | 'play_services' | 'no_token' | 'failed', message?: string) {
    super(message ?? code);
  }
}

/** Returns a Google ID token, or null if the user cancelled. */
export async function getGoogleIdToken(): Promise<string | null> {
  const mod = load();
  if (!mod) throw new GoogleSignInError('unavailable');
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = mod;
  if (!configured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always show the account picker instead of silently reusing the last one.
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null; // cancelled
    const token = res.data.idToken;
    if (!token) throw new GoogleSignInError('no_token');
    return token;
  } catch (e) {
    if (e instanceof GoogleSignInError) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (e.code === statusCodes.IN_PROGRESS) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new GoogleSignInError('play_services');
    }
    throw new GoogleSignInError('failed', e instanceof Error ? e.message : String(e));
  }
}
