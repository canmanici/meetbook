import { useState, useEffect, useCallback } from 'react';
import { router } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  Alert,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/secure-store';
import { logout } from '@/lib/api/client';

const THEME_KEY = 'theme_preference';
const IMG_CACHE_PREFIX = '@meetbook_img_';

type ThemePref = 'system' | 'light' | 'dark';

const THEME_LABEL: Record<ThemePref, string> = {
  system: 'Sistem',
  light: 'Aydınlık',
  dark: 'Karanlık',
};

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);
  const toast = useToast();

  const [themePref, setThemePrefState] = useState<ThemePref>('system');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') {
          setThemePrefState(v);
        }
      })
      .catch(() => {});
  }, []);

  const setThemePref = useCallback((pref: ThemePref) => {
    setThemePrefState(pref);
    AsyncStorage.setItem(THEME_KEY, pref).catch(() => {});
  }, []);

  const resolvedDark =
    themePref === 'system' ? scheme === 'dark' : themePref === 'dark';
  const colors = palette[resolvedDark ? 'dark' : 'light'];

  const handleLogout = () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Çıkış Yap',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout({ refresh_token: refreshToken ?? '' });
          } catch {
            /* best-effort */
          }
          await clearTokens();
          clearSession();
          router.replace('/auth/login');
        },
      },
    ]);
  };

  const handleFeedback = () => {
    Linking.openURL('mailto:support@meetbook.com').catch(() => {
      toast.show('E-posta uygulaması açılamadı', { variant: 'error' });
    });
  };

  const handlePrivacy = () => {
    Linking.openURL('https://canmanici.com/meetbook/privacy').catch(() => {
      toast.show('Tarayıcı açılamadı', { variant: 'error' });
    });
  };

  const handleTheme = () => {
    Alert.alert('Tema', 'Bir tema seçin', [
      { text: 'Sistem', onPress: () => setThemePref('system') },
      { text: 'Aydınlık', onPress: () => setThemePref('light') },
      { text: 'Karanlık', onPress: () => setThemePref('dark') },
      { text: 'İptal', style: 'cancel' },
    ]);
  };

  const handleAbout = () => {
    toast.show('MeetBook v1.0.1 · © 2026 MeetBook · İstanbul', { variant: 'info' });
  };

  const handleClearCache = () => {
    Alert.alert(
      'Önbelleği Temizle',
      'Görsel önbelleği temizlemek istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            try {
              const keys = await AsyncStorage.getAllKeys();
              const cacheKeys = (keys ?? []).filter((k) =>
                String(k).startsWith(IMG_CACHE_PREFIX),
              );
              if (cacheKeys.length > 0) {
                await AsyncStorage.multiRemove(cacheKeys);
              }
              toast.show(`Önbellek temizlendi (${cacheKeys.length} öğe)`, { variant: 'success' });
            } catch {
              toast.show('Önbellek temizlenemedi', { variant: 'error' });
            }
          },
        },
      ],
    );
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ayarlar</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>HESAP</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push('/tabs/profile?edit=1')}
              activeOpacity={0.6}
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>Profilimi Düzenle</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>UYGULAMA</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <TouchableOpacity style={styles.row} onPress={handleTheme} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Tema</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>
                {THEME_LABEL[themePref]}
              </Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={() => {}} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Dil</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>Türkçe</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={handleClearCache} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Önbelleği Temizle</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={handleAbout} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Hakkında</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>1.0.1</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>DESTEK</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <TouchableOpacity style={styles.row} onPress={handleFeedback} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Geri Bildirim Gönder</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={handlePrivacy} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Gizlilik Politikası</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
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
