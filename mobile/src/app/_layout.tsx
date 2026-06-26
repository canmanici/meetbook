import { QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ToastProvider } from '@/components/ui/toast-provider';
import { palette } from '@/components/ui/tokens';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { ServerErrorOverlay } from '@/components/server-error-overlay';
import { OfflineBanner } from '@/components/offline-banner';
import { getMe } from '@/lib/api/client';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const themePref = useThemeStore((s) => s.preference);
  const loadPreference = useThemeStore((s) => s.loadPreference);
  const effectiveScheme = themePref === 'system' ? systemScheme : themePref;
  const isDark = effectiveScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  const segments = useSegments();

  useEffect(() => {
    bootstrap();
    loadPreference();
  }, [bootstrap, loadPreference]);

  useEffect(() => {
    AsyncStorage.getItem('hasOnboarded').then((value) => {
      setHasOnboarded(value === null ? false : value === 'true');
    });
  }, [segments]);

  // After bootstrap confirms tokens exist, fetch the user profile.
  // This is separate from bootstrap() to avoid circular dependencies
  // (the API client imports useAuthStore).
  useEffect(() => {
    if (status === 'authenticated' && !user) {
      getMe()
        .then((me) => {
          useAuthStore.getState().setUser({
            id: me.id,
            email: me.email,
            name: me.name,
          });
        })
        .catch(() => {
          // Network error or expired token — user stays null.
          // UI components handle null user gracefully (owner checks return false).
        });
    }
  }, [status, user]);

  if (hasOnboarded === null) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <AnimatedSplashOverlay />
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </QueryClientProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AnimatedSplashOverlay />
        <AppErrorBoundary>
        <ToastProvider>
        <OfflineBanner />
        <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surface,
          },
          headerTintColor: colors.text,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Protected guard={hasOnboarded === false}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={hasOnboarded === true && status === 'unauthenticated'}>
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={hasOnboarded === true && status === 'authenticated'}>
          <Stack.Screen name="tabs" options={{ headerShown: false }} />
          <Stack.Screen name="book" options={{ headerShown: false }} />
          <Stack.Screen name="exchange" options={{ headerShown: false }} />
          <Stack.Screen name="meetup" options={{ headerShown: false }} />
          <Stack.Screen name="wishlist" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
        <ServerErrorOverlay />
        </ToastProvider>
        </AppErrorBoundary>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
