import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hasOnboarded';

interface OnboardingState {
  // null = not yet loaded from storage
  hasOnboarded: boolean | null;
  load: () => Promise<void>;
  complete: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasOnboarded: null,

  load: async () => {
    try {
      const value = await AsyncStorage.getItem(STORAGE_KEY);
      set({ hasOnboarded: value === 'true' });
    } catch {
      // AsyncStorage unavailable (e.g. Expo Go SDK 54). Assume onboarded so
      // the auth flow can take over instead of leaving the app stuck.
      set({ hasOnboarded: true });
    }
  },

  complete: async () => {
    set({ hasOnboarded: true });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // best-effort persist; state is already updated in memory
    }
  },
}));
