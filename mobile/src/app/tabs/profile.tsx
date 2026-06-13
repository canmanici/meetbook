import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { getMe, listMyBooks, getWishlist, logout } from '@/lib/api/client';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

const MENU_SECTIONS = [
  {
    items: [
      { key: 'books', label: 'Kitaplarım', icon: 'library-outline' as const, route: '/book/my-books' as const, badge: 'books' as const },
      { key: 'wishlist', label: 'İstek Listem', icon: 'heart-outline' as const, route: '/wishlist' as const, badge: 'wishlist' as const },
    ],
  },
  {
    items: [
      { key: 'trusted', label: 'Güvendiğim Kişi', icon: 'shield-checkmark-outline' as const, badge: null },
      { key: 'privacy', label: 'Gizlilik & Güvenlik', icon: 'lock-closed-outline' as const, badge: null },
      { key: 'settings', label: 'Ayarlar', icon: 'settings-outline' as const, route: '/settings' as const, badge: null },
    ],
  },
] as const;

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  const { isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  const { data: booksData } = useQuery({
    queryKey: ['books', 'me'],
    queryFn: () => listMyBooks(),
  });
  const books = booksData?.items ?? [];

  const { data: wishlistData } = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => getWishlist(),
  });
  const wishlistCount = wishlistData?.items?.length ?? 0;

  const handleLogout = async () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Çıkış Yap',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout({ refresh_token: refreshToken ?? '' });
          } catch { /* best-effort */ }
          await clearTokens();
          clearSession();
          router.replace('/auth/login');
        },
      },
    ]);
  };

  if (meLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.loadingContent}>
          <Skeleton variant="card" />
          <Skeleton variant="list-item" />
        </View>
      </View>
    );
  }

  const displayName = user?.name ?? 'Kullanıcı';
  const displayEmail = user?.email ?? '';

  const gradientColors: [string, string] = isDark
    ? ['#1a3a2f', '#0d2018']
    : ['#0F6E5D', '#094d41'];

  const statItems = [
    { value: 0, label: 'Takas', color: colors.primary },
    { value: books.length, label: 'Kitap', color: colors.accent },
    { value: 0, label: 'Puan', color: colors.success },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroGradient, { paddingTop: insets.top + spacing.xl }]}
      >
        <View style={styles.heroContent}>
          <Avatar name={displayName} size="large" verified={false} />
          <Text style={styles.heroName}>{displayName}</Text>
          <Text style={styles.heroEmail}>{displayEmail}</Text>
        </View>
      </LinearGradient>

      <View style={styles.statsRow}>
        {statItems.map((stat) => (
          <View key={stat.label} style={styles.statWrapper}>
            <View style={[styles.statTopBorder, { backgroundColor: stat.color }]} />
            <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{stat.label}</Text>
            </View>
          </View>
        ))}
      </View>

      {MENU_SECTIONS.map((section, sIdx) => (
        <View
          key={sIdx}
          style={[styles.menuSection, { backgroundColor: colors.surface, borderRadius: radius.input }]}
        >
          {section.items.map((item, iIdx) => {
            const badgeCount =
              item.badge === 'books' ? books.length :
              item.badge === 'wishlist' ? wishlistCount : 0;

            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.menuItem,
                  iIdx < section.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.textMuted + '20' },
                ]}
                onPress={() => {
                  if ('route' in item && item.route) {
                    router.push(item.route as any);
                  }
                }}
                activeOpacity={0.7}
              >
                <Ionicons name={item.icon} size={20} color={colors.textMuted} style={styles.menuIcon} />
                <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
                <View style={styles.menuRight}>
                  {badgeCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.badgeText}>{badgeCount}</Text>
                    </View>
                  )}
                  {'route' in item && item.route && (
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <View style={[styles.menuSection, { backgroundColor: colors.surface, borderRadius: radius.input }]}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleLogout}
          activeOpacity={0.7}
          testID="logout-button"
        >
          <Ionicons name="log-out-outline" size={20} color={colors.danger} style={styles.menuIcon} />
          <Text style={[styles.menuLabel, { color: colors.danger }]}>Çıkış Yap</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.footer, { color: colors.textMuted }]}>MeetBook v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroGradient: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  heroContent: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: '#fff',
    marginTop: spacing.md,
  },
  heroEmail: {
    fontSize: fontSize.bodySm,
    color: 'rgba(255,255,255,0.7)',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
  statWrapper: {
    flex: 1,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  statTopBorder: {
    height: 3,
  },
  statCard: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  statValue: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  menuSection: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuIcon: {
    marginRight: spacing.md,
    width: 24,
    textAlign: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.caption,
    marginTop: spacing.lg,
  },
});
