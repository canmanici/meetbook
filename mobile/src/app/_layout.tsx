import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ToastProvider } from '@/components/ui/toast-provider';
import { palette } from '@/components/ui/tokens';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { ServerErrorOverlay } from '@/components/server-error-overlay';
import { OfflineBanner } from '@/components/offline-banner';
import { UpdateManager } from '@/components/update-manager';
import { CallManager } from '@/components/call-manager';
import { getMe } from '@/lib/api/client';
import { crashReporter } from '@/lib/crash-reporter';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function RootLayout() {
  // Initialize crash reporter once on app start
  const reporterInitialized = useRef(false);
  if (!reporterInitialized.current) {
    reporterInitialized.current = true;
    crashReporter.initialize();
  }

  const systemScheme = useColorScheme();
  const themePref = useThemeStore((s) => s.preference);
  const loadPreference = useThemeStore((s) => s.loadPreference);
  const effectiveScheme = themePref === 'system' ? systemScheme : themePref;
  const isDark = effectiveScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  const hasOnboarded = useOnboardingStore((s) => s.hasOnboarded);
  const loadOnboarding = useOnboardingStore((s) => s.load);
  const segments = useSegments();

  useEffect(() => {
    bootstrap();
    loadPreference();
    loadOnboarding();
  }, [bootstrap, loadPreference, loadOnboarding]);

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
            username: (me as any).username,
            avatarUrl: (me as any).avatar_url ?? undefined,
          });
        })
        .catch(() => {
          // Network error or expired token — user stays null.
          // UI components handle null user gracefully (owner checks return false).
        });
    }
  }, [status, user]);

  // Track current user for crash context
  useEffect(() => {
    if (user?.id) {
      crashReporter.setUser(user.id);
    }
  }, [user?.id]);

  // Track screen changes for crash context
  useEffect(() => {
    const screen = segments.join('/') || 'root';
    crashReporter.setCurrentScreen(screen);
  }, [segments]);

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
        {status === 'authenticated' && <CallManager />}
        <UpdateManager />
        <Stack
        screenOptions={{
          // Every screen draws its own header. Without this, any route not
          // listed below shows a raw default header ("chat/club", "search/users").
          headerShown: false,
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
          <Stack.Screen name="personality-books" options={{ headerShown: false }} />
          <Stack.Screen name="verify-email" options={{ headerShown: false }} />
          <Stack.Screen name="book" options={{ headerShown: false }} />
          <Stack.Screen name="exchange" options={{ headerShown: false }} />
          <Stack.Screen name="meetup" options={{ headerShown: false }} />
          <Stack.Screen name="wishlist" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="chat/club" options={{ headerShown: false }} />
          <Stack.Screen name="chat/starred" options={{ headerShown: false }} />
          <Stack.Screen name="chat/info/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="search/users" options={{ headerShown: false }} />
          <Stack.Screen
            name="call"
            options={{ headerShown: false, gestureEnabled: false, animation: 'none' }}
          />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="saved-searches" options={{ headerShown: false }} />
          <Stack.Screen name="year-in-review" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
        <ServerErrorOverlay />
        </ToastProvider>
        </AppErrorBoundary>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
