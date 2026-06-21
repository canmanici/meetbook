import { Tabs } from 'expo-router';
import { Text, View, useColorScheme, ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { palette, fontSize } from '@/components/ui/tokens';
import { listExchanges } from '@/lib/api/client';

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  'my-books': 'library',
  requests: 'clipboard',
  chats: 'chatbubble',
  profile: 'person',
};

function TabIcon({ name, color, focused, pillColor, badgeCount }: { name: keyof typeof TAB_ICONS; color: ColorValue; focused?: boolean; pillColor?: string; badgeCount?: number }) {
  const iconName = TAB_ICONS[name];
  return (
    <View
      style={{
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: focused ? pillColor : 'transparent',
      }}
    >
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
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 88,
          paddingBottom: 20,
          paddingTop: 4,
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Ana Sayfa',
          tabBarButtonTestID: 'home-tab',
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} pillColor={colors.primarySoft} />,
        }}
      />
      <Tabs.Screen
        name="my-books"
        options={{
          title: 'Kitaplarım',
          tabBarButtonTestID: 'my-books-tab',
          tabBarIcon: ({ color, focused }) => <TabIcon name="my-books" color={color} focused={focused} pillColor={colors.primarySoft} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Talepler',
          tabBarButtonTestID: 'requests-tab',
          tabBarIcon: ({ color, focused }) => <TabIcon name="requests" color={color} focused={focused} pillColor={colors.primarySoft} badgeCount={pendingCount > 0 ? pendingCount : undefined} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Mesajlar',
          tabBarButtonTestID: 'chats-tab',
          tabBarIcon: ({ color, focused }) => <TabIcon name="chats" color={color} focused={focused} pillColor={colors.primarySoft} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarButtonTestID: 'profile-tab',
          tabBarIcon: ({ color, focused }) => <TabIcon name="profile" color={color} focused={focused} pillColor={colors.primarySoft} />,
        }}
      />
    </Tabs>
  );
}
