/**
 * Self-hosted APK updates (Android, outside the Play Store).
 *
 * Flow: GET /app/android/latest?version_code=<installed> → download the APK
 * into the cache with progress → verify size + MD5 against the server →
 * hand it to Android's package installer. Android itself refuses the install
 * unless the APK is signed with the same key as the installed app, and asks
 * the user once to allow "install unknown apps" for MeetBook.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
const ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '');
const APK_MIME = 'application/vnd.android.package-archive';

export interface AppRelease {
  version_code: number;
  version_name: string;
  size_bytes: number;
  sha256: string;
  md5: string;
  changelog: string | null;
  mandatory: boolean;
  download_path: string;
  created_at: string;
}

export interface UpdateCheck {
  update_available: boolean;
  mandatory: boolean;
  latest: AppRelease | null;
  /** The installed build was withdrawn by an admin (emergency). */
  current_withdrawn?: boolean;
  below_minimum?: boolean;
  /** Message for the user (withdraw reason / minimum-version message). */
  notice?: string | null;
}

export const updatesSupported = Platform.OS === 'android';

/** versionCode of the installed build (0 if unknown → always "outdated"). */
export function installedVersionCode(): number {
  const n = parseInt(Application.nativeBuildVersion ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

export function installedVersionName(): string {
  return Application.nativeApplicationVersion ?? '?';
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const res = await fetch(`${API_URL}/app/android/latest?version_code=${installedVersionCode()}`);
  if (!res.ok) throw new Error(`update check failed: ${res.status}`);
  return (await res.json()) as UpdateCheck;
}

export class UpdateError extends Error {
  constructor(public code: 'download' | 'corrupt' | 'install', message?: string) {
    super(message ?? code);
  }
}

let active: FileSystem.DownloadResumable | null = null;

/** Download + verify. Returns the local file URI. */
export async function downloadRelease(
  release: AppRelease,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const target = `${FileSystem.cacheDirectory}meetbook-${release.version_code}.apk`;
  // Reuse a previous complete, verified download.
  const existing = await FileSystem.getInfoAsync(target, { md5: true });
  if (existing.exists && existing.size === release.size_bytes && existing.md5 === release.md5) {
    onProgress(1);
    return target;
  }
  await FileSystem.deleteAsync(target, { idempotent: true });

  active = FileSystem.createDownloadResumable(`${ORIGIN}${release.download_path}`, target, {}, (p) => {
    const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : release.size_bytes;
    onProgress(Math.min(1, p.totalBytesWritten / total));
  });
  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await active.downloadAsync();
  } catch (e) {
    throw new UpdateError('download', e instanceof Error ? e.message : String(e));
  } finally {
    active = null;
  }
  if (!result || result.status !== 200) throw new UpdateError('download', `HTTP ${result?.status}`);

  // Integrity: a truncated / tampered file must never reach the installer.
  const info = await FileSystem.getInfoAsync(target, { md5: true });
  if (!info.exists || info.size !== release.size_bytes || info.md5 !== release.md5) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new UpdateError('corrupt');
  }
  return target;
}

export async function cancelDownload(): Promise<void> {
  try {
    await active?.cancelAsync();
  } catch {
    /* already finished */
  }
  active = null;
}

/** Open Android's package installer for the downloaded APK. */
export async function installApk(fileUri: string): Promise<void> {
  try {
    const contentUri = await FileSystem.getContentUriAsync(fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (e) {
    throw new UpdateError('install', e instanceof Error ? e.message : String(e));
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
