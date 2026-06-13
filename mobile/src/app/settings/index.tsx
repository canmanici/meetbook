import { router } from 'expo-router';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, useColorScheme, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/secure-store';
import { logout } from '@/lib/api/client';

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  const handleLogout = () => {
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ayarlar</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>HESAP</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <TouchableOpacity style={styles.row} onPress={() => router.push('/tabs/profile')}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Profilimi Düzenle</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>UYGULAMA</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Tema</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>
                {isDark ? 'Karanlık' : 'Aydınlık'}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Sürüm</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>1.0.0</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>DESTEK</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Geri Bildirim Gönder</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Gizlilik Politikası</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={[styles.logoutButton]} onPress={handleLogout} activeOpacity={0.7}>
          <Text style={[styles.logoutText, { color: colors.danger }]}>Çıkış Yap</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowLabel: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: fontSize.body,
  },
  chevron: {
    fontSize: fontSize.heading,
    fontWeight: '300',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  logoutButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  logoutText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
