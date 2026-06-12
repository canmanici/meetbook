import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { palette } from '@/components/ui/tokens';
import { AnimatedSplashOverlay } from '@/components/animated-icon';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <>
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
        <Stack.Screen
          name="tabs"
          options={{ headerShown: false }}
        />
      </Stack>
    </>
  );
}
