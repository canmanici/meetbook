/**
 * Device / app identity sent to the backend so admins can see which device a
 * login, session or crash came from (the server adds real IP + ISP itself).
 *
 * - Every request: short X-Client-* headers (platform, OS version, model code,
 *   app version) — cheap, used for per-request context.
 * - Auth requests (/auth/*): the full, verbose profile in one base64url JSON
 *   header (X-Client-Info). Sessions are created there, so that's where the
 *   detail is stored; sending ~1 KB on every request would be waste.
 *
 * All native reads are guarded: Jest / web / Expo Go degrade to fewer fields.
 */
import { Dimensions, Platform } from 'react-native';

type Info = Record<string, string | number | boolean | string[] | null>;

let Device: any = null;
let Application: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native modules
  Device = require('expo-device');
} catch {}
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native modules
  Application = require('expo-application');
} catch {}

const DEVICE_TYPES: Record<number, string> = { 0: 'unknown', 1: 'phone', 2: 'tablet', 3: 'desktop', 4: 'tv' };

function safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

function buildInfo(): Info {
  const screen = safe(() => Dimensions.get('screen'));
  const intl = safe(() => Intl.DateTimeFormat().resolvedOptions());
  const info: Info = {
    platform: Platform.OS,
    // hardware
    brand: safe(() => Device?.brand),
    manufacturer: safe(() => Device?.manufacturer),
    model_name: safe(() => Device?.modelName),          // "Galaxy S23 Ultra" / "iPhone 15 Pro"
    model_id: safe(() => Device?.modelId),              // iOS: "iPhone16,1"
    product_name: safe(() => Device?.productName),      // Android: "dm3qxxx"
    design_name: safe(() => Device?.designName),        // Android: "dm3q"
    device_type: safe(() => DEVICE_TYPES[Device?.deviceType ?? 0] ?? null),
    device_year_class: safe(() => Device?.deviceYearClass),
    total_memory_mb: safe(() => (Device?.totalMemory ? Math.round(Device.totalMemory / 1048576) : null)),
    cpu_archs: safe(() => Device?.supportedCpuArchitectures),
    is_physical_device: safe(() => Device?.isDevice),
    device_name: safe(() => Device?.deviceName),        // user-set name, e.g. "Can'ın iPhone'u"
    // OS
    os_name: safe(() => Device?.osName),
    os_version: safe(() => Device?.osVersion),
    os_build_id: safe(() => Device?.osBuildId),
    os_internal_build_id: safe(() => Device?.osInternalBuildId),
    os_build_fingerprint: safe(() => Device?.osBuildFingerprint),
    api_level: safe(() => Device?.platformApiLevel),
    // app
    app_id: safe(() => Application?.applicationId),
    app_version: safe(() => Application?.nativeApplicationVersion),
    app_build: safe(() => Application?.nativeBuildVersion),
    install_source: safe(() => (Platform.OS === 'android' ? 'apk' : null)),
    // stable per-install device id (Android ID) — spots ban evasion across accounts
    device_id: safe(() => (Platform.OS === 'android' ? Application?.getAndroidId?.() : null)),
    // environment
    screen: screen ? `${Math.round(screen.width * screen.scale)}x${Math.round(screen.height * screen.scale)}@${screen.scale}` : null,
    locale: intl?.locale ?? null,
    timezone: intl?.timeZone ?? null,
  };
  for (const k of Object.keys(info)) if (info[k] === null || info[k] === '') delete info[k];
  return info;
}

let cached: Info | null = null;
let encoded: string | null = null;

function info(): Info {
  if (!cached) {
    cached = buildInfo();
    // iOS vendor id is async — fill it in for later requests.
    if (Platform.OS === 'ios' && Application?.getIosIdForVendorAsync) {
      Application.getIosIdForVendorAsync()
        .then((id: string | null) => {
          if (id && cached) {
            cached.device_id = id;
            encoded = null;
          }
        })
        .catch(() => {});
    }
  }
  return cached;
}

function toBase64Url(json: string): string | null {
  try {
    // UTF-8 safe (device names can contain "ı", "’", emoji…)
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return null;
  }
}

/** ASCII-only header value. */
function ascii(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\x20-\x7E]/g, '').slice(0, 100);
  return s || null;
}

export function clientHeaders(path = ''): Record<string, string> {
  const i = info();
  const h: Record<string, string> = {};
  const set = (k: string, v: unknown) => {
    const a = ascii(v);
    if (a) h[k] = a;
  };
  set('X-Client-Platform', i.platform);
  set('X-Client-OS-Version', i.os_version);
  set('X-Client-Device-Model', i.model_id ?? i.model_name);
  set('X-Client-App-Version', i.app_version ? `${i.app_version}${i.app_build ? `+${i.app_build}` : ''}` : null);
  if (path.startsWith('/auth/')) {
    if (encoded === null) encoded = toBase64Url(JSON.stringify(i));
    if (encoded) h['X-Client-Info'] = encoded;
  }
  return h;
}

/** Full profile (for crash reports and debugging screens). */
export function clientInfo(): Info {
  return { ...info() };
}
