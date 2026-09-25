import { useState, useEffect, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  Alert,
  Linking,
  Platform,
  Switch,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { palette, spacing, fontSize, radius } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/secure-store';
import { authedRequest, getMe, logout, updateMe } from '@/lib/api/client';

const THEME_KEY = 'theme_preference';
const IMG_CACHE_PREFIX = '@meetbook_img_';
const ANDROID_PACKAGE = 'com.canmanici.meetbook';
const IOS_APP_ID = 'idYOUR_APP_ID';

type ThemePref = 'system' | 'light' | 'dark';

const THEME_LABEL: Record<ThemePref, string> = {
  system: 'Sistem',
  light: 'Aydınlık',
  dark: 'Karanlık',
};

// B11: push notification event toggles shown to the user.
const NOTIFICATION_EVENTS: { key: string; label: string }[] = [
  { key: 'new_exchange_request', label: 'Yeni takas isteği' },
  { key: 'new_message', label: 'Mesaj' },
  { key: 'meetup_reminder', label: 'Buluşma hatırlatma' },
  { key: 'book_favorited', label: 'Kitapın beğenildi' },
  { key: 'wishlist_match', label: 'İstek listem bulundu' },
];

// B12: active session shape returned by /auth/me/sessions.
type SessionItem = {
  id: string;
  device_info: { platform?: string; os?: string; device?: string; [k: string]: any } | null;
  created_at: string;
  is_current: boolean;
};

function describeDevice(info: SessionItem['device_info']): string {
  if (!info) return 'Bilinmeyen cihaz';
  const parts: string[] = [];
  if (info.platform) parts.push(info.platform);
  else if (info.os) parts.push(info.os);
  if (info.device) parts.push(info.device);
  return parts.length ? parts.join(' · ') : 'Bu cihaz';
}

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);
  const toast = useToast();

  const [themePref, setThemePrefState] = useState<ThemePref>('system');

  const queryClient = useQueryClient();

  // B11: fetch the current user (incl. notification_settings) and sessions.
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => getMe() });
  const notificationSettings: Record<string, boolean> =
    (meData as any)?.notification_settings ?? {};

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () => authedRequest<{ items: SessionItem[] }>('/auth/me/sessions', 'GET', undefined),
  });
  const sessions = sessionsData?.items ?? [];

  const handleToggleNotification = useCallback(
    (key: string, value: boolean) => {
      const next = { ...notificationSettings, [key]: value };
      updateMe({ notification_settings: next } as any)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['me'] });
        })
        .catch(() => {
          toast.show('Tercih kaydedilemedi', { variant: 'error' });
        });
    },
    [notificationSettings, queryClient, toast],
  );

  const handleRevokeSession = useCallback(
    (sessionId: string) => {
      Alert.alert(
        'Cihazı Çıkış Yap',
        'Bu cihazdaki oturum sonlandırılsın mı?',
        [
          { text: 'İptal', style: 'cancel' },
          {
            text: 'Çıkış Yap',
            style: 'destructive',
            onPress: async () => {
              try {
                await authedRequest(`/auth/me/sessions/${sessionId}`, 'DELETE', undefined);
                queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
                toast.show('Oturum sonlandırıldı', { variant: 'success' });
              } catch {
                toast.show('Oturum sonlandırılamadı', { variant: 'error' });
              }
            },
          },
        ],
      );
    },
    [queryClient, toast],
  );

  const [exporting, setExporting] = useState(false);
  const handleExportHistory = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await authedRequest('/auth/me/reading-history/export', 'GET', undefined);
      toast.show('Okuma geçmişiniz hazır', { variant: 'success' });
    } catch {
      toast.show('Dışa aktarma başarısız', { variant: 'error' });
    } finally {
      setExporting(false);
    }
  }, [exporting, toast]);

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
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
    const serverUrl = apiUrl.replace(/\/api\/v1$/, '');
    Linking.openURL(`${serverUrl}/legal/gizlilik-politikasi`).catch(() => {
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
                await AsyncStorage.removeMany(cacheKeys);
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

  const handleClearImageCache = () => {
    Alert.alert(
      'Görsel Önbelleğini Temizle',
      'Görsel önbelleğini temizlemek istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            try {
              await Image.clearMemoryCache();
              await Image.clearDiskCache();
              toast.show('Görsel önbelleği temizlendi', { variant: 'success' });
            } catch {
              toast.show('Görsel önbelleği temizlenemedi', { variant: 'error' });
            }
          },
        },
      ],
    );
  };

  const handleRateApp = async () => {
    const storeUrl =
      Platform.OS === 'android'
        ? `market://details?id=${ANDROID_PACKAGE}`
        : `itms-apps://itunes.apple.com/app/${IOS_APP_ID}`;
    const fallbackUrl =
      Platform.OS === 'android'
        ? `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`
        : `https://apps.apple.com/app/${IOS_APP_ID}`;
    try {
      const supported = await Linking.canOpenURL(storeUrl);
      await Linking.openURL(supported ? storeUrl : fallbackUrl);
    } catch {
      try {
        await Linking.openURL(fallbackUrl);
      } catch {
        toast.show('Uygulama mağazası açılamadı', { variant: 'error' });
      }
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ayarlar</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>HESAP</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.replace('/tabs/profile?edit=1' as any)}
              activeOpacity={0.6}
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>Profilimi Düzenle</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push('/settings/data-export' as any)}
              activeOpacity={0.6}
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>Verilerimi İndir</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity
              style={styles.row}
              onPress={handleExportHistory}
              disabled={exporting}
              activeOpacity={0.6}
              testID="reading-history-export"
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>Okuma Geçmişini Dışa Aktar</Text>
              {exporting ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
              )}
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push('/settings/delete-account' as any)}
              activeOpacity={0.6}
            >
              <Text style={[styles.rowLabel, { color: colors.danger }]}>Hesabımı Sil</Text>
              <Text style={[styles.chevron, { color: colors.danger }]}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* B11: Notification preferences */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>BİLDİRİM TERCİHLERİ</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {NOTIFICATION_EVENTS.map((evt, idx) => {
              const enabled = notificationSettings[evt.key] !== false;
              return (
                <View key={evt.key}>
                  {idx > 0 ? (
                    <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
                  ) : null}
                  <View style={styles.row}>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>{evt.label}</Text>
                    <Switch
                      value={enabled}
                      onValueChange={(v) => handleToggleNotification(evt.key, v)}
                      trackColor={{ false: colors.textMuted + '44', true: colors.primary }}
                      testID={`notif-toggle-${evt.key}`}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* B12: Active devices / sessions */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>AKTİF CİHAZLAR</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {sessionsLoading ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color={colors.textMuted} />
              </View>
            ) : sessions.length === 0 ? (
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.textMuted }]}>
                  Aktif cihaz bulunamadı
                </Text>
              </View>
            ) : (
              sessions.map((s, idx) => (
                <View key={s.id}>
                  {idx > 0 ? (
                    <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
                  ) : null}
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionInfo}>
                      <Text style={[styles.rowLabel, { color: colors.text }]}>
                        {describeDevice(s.device_info)}
                      </Text>
                      <Text style={[styles.sessionSub, { color: colors.textMuted }]}>
                        {new Date(s.created_at).toLocaleDateString('tr-TR')}
                      </Text>
                    </View>
                    {s.is_current ? (
                      <Text style={[styles.currentBadge, { color: colors.primary }]}>Bu cihaz</Text>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleRevokeSession(s.id)}
                        activeOpacity={0.6}
                        testID={`revoke-session-${s.id}`}
                      >
                        <Text style={[styles.revokeText, { color: colors.danger }]}>Çıkış Yap</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            )}
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
            {/* Turkish is the only language — informational row, not a button. */}
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Dil</Text>
              <Text style={[styles.rowValue, { color: colors.textMuted }]}>Türkçe</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={handleClearCache} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Önbelleği Temizle</Text>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
            <TouchableOpacity style={styles.row} onPress={handleClearImageCache} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Görsel Önbelleği Temizle</Text>
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
            <TouchableOpacity style={styles.row} onPress={handleRateApp} activeOpacity={0.6}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Uygulamayı Değerlendir</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
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
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionSub: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  currentBadge: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  revokeText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
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
