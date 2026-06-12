import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { palette } from '@/components/ui/tokens';
import AppTabs from '@/components/app-tabs';

export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}>
      <Stack.Screen
        name="home"
        options={{ title: 'Home' }}
      />
      <Stack.Screen
        name="search"
        options={{ title: 'Search' }}
      />
      <Stack.Screen
        name="requests"
        options={{ title: 'Requests' }}
      />
      <Stack.Screen
        name="chats"
        options={{ title: 'Chats' }}
      />
      <Stack.Screen
        name="profile"
        options={{ title: 'Profile' }}
      />
    </Stack>
  );
}
