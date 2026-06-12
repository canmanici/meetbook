import { router } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useColorScheme } from 'react-native';

import { Button, palette, spacing, fontSize } from '@/components/ui';
import { logout } from '@/lib/api/client';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {user?.name ?? 'Kullanıcı'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {user?.email ?? ''}
      </Text>
      <Button
        onPress={onLogout}
        variant="danger"
        testID="logout-button"
        style={styles.logoutButton}>
        Çıkış yap
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: 'bold',
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  logoutButton: {
    minWidth: 160,
  },
});
