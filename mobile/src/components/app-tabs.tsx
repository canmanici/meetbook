import { Tabs } from 'expo-router';
import { Text, useColorScheme, ColorValue } from 'react-native';

import { palette, fontSize } from '@/components/ui/tokens';

const TAB_ICONS: Record<string, string> = {
  home: '🏠',
  search: '🔍',
  requests: '📋',
  chats: '💬',
  profile: '👤',
};

function TabIcon({ name, color }: { name: keyof typeof TAB_ICONS; color: ColorValue }) {
  return <Text style={{ fontSize: fontSize.heading, color }}>{TAB_ICONS[name]}</Text>;
}

export function AppTabs() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarButtonTestID: 'home-tab',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarButtonTestID: 'search-tab',
          tabBarIcon: ({ color }) => <TabIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarButtonTestID: 'requests-tab',
          tabBarIcon: ({ color }) => <TabIcon name="requests" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarButtonTestID: 'chats-tab',
          tabBarIcon: ({ color }) => <TabIcon name="chats" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButtonTestID: 'profile-tab',
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
    </Tabs>
  );
}
