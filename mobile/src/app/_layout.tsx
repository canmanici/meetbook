import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme } from 'react-native';

import { ToastProvider } from '@/components/ui/toast-provider';
import { palette } from '@/components/ui/tokens';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { getMe } from '@/lib/api/client';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AnimatedSplashOverlay />
        <ToastProvider>
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
        <Stack.Protected guard={status === 'unauthenticated'}>
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'authenticated'}>
          <Stack.Screen name="tabs" options={{ headerShown: false }} />
          <Stack.Screen name="book" options={{ headerShown: false }} />
          <Stack.Screen name="exchange" options={{ headerShown: false }} />
          <Stack.Screen name="meetup" options={{ headerShown: false }} />
          <Stack.Screen name="wishlist" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="user" options={{ headerShown: false }} />
          <Stack.Screen name="chat" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      </ToastProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
