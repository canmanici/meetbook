import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  loadPreference: () => Promise<void>;
}

const STORAGE_KEY = 'theme_preference';

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  setPreference: (pref) => {
    // Expo Go SDK 54: AsyncStorage unavailable — .catch() to prevent crash
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
    set({ preference: pref });
  },
  loadPreference: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'system' || stored === 'light' || stored === 'dark') {
        set({ preference: stored });
      }
    } catch {
      // AsyncStorage unavailable in Expo Go — use default 'system'
    }
  },
}));
