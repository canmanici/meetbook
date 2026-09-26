import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  type AppRelease,
  UpdateError,
  cancelDownload,
  checkForUpdate,
  downloadRelease,
  installApk,
  updatesSupported,
} from '@/lib/app-update';

const SNOOZE_KEY = 'update_snoozed'; // {version_code, until}
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  release: AppRelease | null;
  mandatory: boolean;
  phase: Phase;
  progress: number;
  error: string | null;
  lastCheckedAt: number;
  /** auto = launch/foreground (respects snooze + interval); manual = Settings button. */
  check: (mode: 'auto' | 'manual') => Promise<'update' | 'none' | 'error'>;
  startUpdate: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => Promise<void>;
}

let downloadedUri: string | null = null;

const errorText = (e: unknown) => {
  if (e instanceof UpdateError) {
    if (e.code === 'corrupt') return 'İndirilen dosya bozuk çıktı. Lütfen tekrar deneyin.';
    if (e.code === 'install') return 'Yükleyici açılamadı. Ayarlar’dan MeetBook için “bilinmeyen uygulamaları yükle” iznini verin.';
  }
  return 'Güncelleme indirilemedi. İnternet bağlantınızı kontrol edin.';
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  release: null,
  mandatory: false,
  phase: 'idle',
  progress: 0,
  error: null,
  lastCheckedAt: 0,

  check: async (mode) => {
    if (!updatesSupported) return 'none';
    const { phase, lastCheckedAt } = get();
    if (phase === 'downloading') return 'update';
    if (mode === 'auto' && Date.now() - lastCheckedAt < AUTO_CHECK_INTERVAL_MS) return 'none';
    let res;
    try {
      res = await checkForUpdate();
    } catch {
      return 'error';
    }
    set({ lastCheckedAt: Date.now() });
    if (!res.update_available || !res.latest) {
      set({ release: null, phase: 'idle' });
      return 'none';
    }
    if (mode === 'auto' && !res.mandatory) {
      try {
        const raw = await AsyncStorage.getItem(SNOOZE_KEY);
        const snooze = raw ? (JSON.parse(raw) as { version_code: number; until: number }) : null;
        if (snooze && snooze.version_code === res.latest.version_code && snooze.until > Date.now()) return 'none';
      } catch {
        /* storage unavailable → just show it */
      }
    }
    set({ release: res.latest, mandatory: res.mandatory, phase: 'available', error: null, progress: 0 });
    return 'update';
  },

  startUpdate: async () => {
    const { release } = get();
    if (!release) return;
    set({ phase: 'downloading', progress: 0, error: null });
    try {
      downloadedUri = await downloadRelease(release, (p) => set({ progress: p }));
      set({ phase: 'ready', progress: 1 });
      await get().install();
    } catch (e) {
      set({ phase: 'error', error: errorText(e) });
    }
  },

  install: async () => {
    if (!downloadedUri) return;
    try {
      await installApk(downloadedUri);
    } catch (e) {
      set({ phase: 'error', error: errorText(e) });
    }
  },

  dismiss: async () => {
    const { release, mandatory, phase } = get();
    if (mandatory) return; // can't skip a mandatory update
    if (phase === 'downloading') await cancelDownload();
    if (release) {
      try {
        await AsyncStorage.setItem(
          SNOOZE_KEY,
          JSON.stringify({ version_code: release.version_code, until: Date.now() + SNOOZE_MS }),
        );
      } catch {
        /* ignore */
      }
    }
    set({ phase: 'idle', release: null, progress: 0, error: null });
  },
}));
