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
    AsyncStorage.setItem(STORAGE_KEY, pref);
    set({ preference: pref });
  },
  loadPreference: async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      set({ preference: stored });
    }
  },
}));
