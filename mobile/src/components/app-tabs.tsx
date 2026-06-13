import { Tabs } from 'expo-router';
import { Text, View, useColorScheme, ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { palette, fontSize } from '@/components/ui/tokens';
import { listExchanges } from '@/lib/api/client';

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  search: 'search',
  requests: 'clipboard',
  chats: 'chatbubble',
  profile: 'person',
};

function TabIcon({ name, color, badgeCount }: { name: keyof typeof TAB_ICONS; color: ColorValue; badgeCount?: number }) {
  const iconName = TAB_ICONS[name];
  return (
    <View style={{ position: 'relative' }}>
      <Ionicons name={iconName} size={22} color={color as string} />
      {badgeCount !== undefined && badgeCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -8,
            backgroundColor: '#ef4444',
            borderRadius: 10,
            minWidth: 18,
            height: 18,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </Text>
        </View>
      )}
    </View>
  );
}

export function AppTabs() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const { data: receivedData } = useQuery({
    queryKey: ['exchanges', 'received', 'badge'],
    queryFn: () => listExchanges({ role: 'received', status: 'pending' }),
    refetchInterval: 30000,
  });
  const pendingCount = receivedData?.items?.length ?? 0;

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
          tabBarIcon: ({ color }) => <TabIcon name="requests" color={color} badgeCount={pendingCount > 0 ? pendingCount : undefined} />,
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
