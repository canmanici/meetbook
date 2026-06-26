import { create } from 'zustand';

import { getTokens } from '@/lib/secure-store';
import { crashReporter } from '@/lib/crash-reporter';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface UserPublic {
  id: string;
  email: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  status: AuthStatus;
  user: UserPublic | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: UserPublic, tokens: AuthTokens) => void;
  setUser: (user: UserPublic) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,

  setSession: (user, tokens) => {
    crashReporter.addBreadcrumb('auth', 'login_success');
    set({
      status: 'authenticated',
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    import('../lib/push-tokens').then(m => m.registerPushToken());
  },

  setUser: (user) => set({ user }),

  clearSession: () => {
    crashReporter.addBreadcrumb('auth', 'logout');
    import('../lib/push-tokens').then(m => m.unregisterPushToken());
    set({ status: 'unauthenticated', user: null, accessToken: null, refreshToken: null });
  },

  bootstrap: async () => {
    const tokens = await getTokens();
    if (tokens) {
      crashReporter.addBreadcrumb('auth', 'token_refreshed');
      set({
        status: 'authenticated',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } else {
      set({ status: 'unauthenticated' });
    }
  },
}));
