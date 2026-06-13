import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { palette } from '@/components/ui/tokens';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/auth-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <AnimatedSplashOverlay />
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
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
