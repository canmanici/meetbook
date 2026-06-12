import { router } from 'expo-router';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  palette,
  spacing,
  fontSize,
} from '@/components/ui';
import { logout } from '@/lib/api/client';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearSession = useAuthStore((state) => state.clearSession);

  const onLogout = async () => {
    try {
      await logout({ refresh_token: refreshToken ?? '' });
    } catch {
      // Best-effort: the user is logging out regardless of API result.
    }
    await clearTokens();
    clearSession();
    router.replace('/auth/login');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Profil
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <Avatar name={user?.name ?? 'K'} size="large" />
          <Text style={[styles.name, { color: colors.text }]}>
            {user?.name ?? 'Kullanıcı'}
          </Text>
          <Text style={[styles.email, { color: colors.textMuted }]}>
            {user?.email ?? ''}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            İstatistikler
          </Text>
          <View style={styles.statsRow}>
            <Badge text="0 takas" variant="primary" />
            <Badge text="0 kitap" variant="info" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Kitaplarım
          </Text>
          <Card>
            <Text style={[styles.emptyBooks, { color: colors.textMuted }]}>
              Henüz kitap eklenmedi
            </Text>
          </Card>
        </View>

        <Button
          onPress={onLogout}
          variant="danger"
          testID="logout-button"
        >
          Çıkış Yap
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  name: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  email: {
    fontSize: fontSize.body,
    marginTop: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyBooks: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
