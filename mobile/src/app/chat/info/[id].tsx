import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Image,
  StyleSheet,
  useColorScheme,
  Alert,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui/tokens';
import { Avatar } from '@/components/ui/avatar';
import { getExchange } from '@/lib/api/client';
import { getChatSettings, updateChatSettings } from '@/lib/api/chat';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function ChatInfoScreen() {
  const { id: exchangeId } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: exchange } = useQuery({
    queryKey: ['exchange', exchangeId],
    queryFn: () => getExchange(exchangeId!),
    enabled: !!exchangeId,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['chat-settings', exchangeId],
    queryFn: () => getChatSettings(exchangeId!),
    enabled: !!exchangeId,
  });

  const settings = settingsData?.settings;

  const toast = useToast();
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);

  const WALLPAPER_OPTIONS: { label: string; colors: string[] }[] = [
    { label: 'Gün Batımı', colors: ['#FF6B6B', '#FFE66D'] },
    { label: 'Okyanus', colors: ['#4DA8DA', '#1A5F7A'] },
    { label: 'Orman', colors: ['#56ab2f', '#a8e063'] },
    { label: 'Mor', colors: ['#8E2DE2', '#4A00E0'] },
    { label: 'Şafak', colors: ['#FF9A8B', '#FF6A88'] },
    { label: 'Gece', colors: ['#232526', '#414345'] },
  ];

  const handleToggleMute = async () => {
    if (!exchangeId || !settings) return;
    await updateChatSettings(exchangeId, { is_muted: !settings.is_muted });
    queryClient.invalidateQueries({ queryKey: ['chat-settings', exchangeId] });
  };

  const handleWallpaperPick = async (gradientColors: string[]) => {
    if (!exchangeId) return;
    try {
      await updateChatSettings(exchangeId, { wallpaper_url: gradientColors.join(',') });
      queryClient.invalidateQueries({ queryKey: ['chat-settings', exchangeId] });
      setShowWallpaperPicker(false);
      toast.show('Duvar kağıdı güncellendi', { variant: 'success' });
    } catch {
      toast.show('Duvar kağıdı güncellenemedi', { variant: 'error' });
    }
  };

  const handleFontSize = () => {
    if (!exchangeId) return;
    Alert.alert('Yazı Boyutu', '', [
      {
        text: 'Küçük',
        onPress: async () => {
          await updateChatSettings(exchangeId, { font_size: 'small' });
          queryClient.invalidateQueries({ queryKey: ['chat-settings', exchangeId] });
        },
      },
      {
        text: 'Orta',
        onPress: async () => {
          await updateChatSettings(exchangeId, { font_size: 'medium' });
          queryClient.invalidateQueries({ queryKey: ['chat-settings', exchangeId] });
        },
      },
      {
        text: 'Büyük',
        onPress: async () => {
          await updateChatSettings(exchangeId, { font_size: 'large' });
          queryClient.invalidateQueries({ queryKey: ['chat-settings', exchangeId] });
        },
      },
      { text: 'İptal', style: 'cancel' },
    ]);
  };

  const handleStarred = () => {
    if (!exchangeId) return;
    router.push(`/chat/${exchangeId}?starred=1`);
  };

  const handlePinned = () => {
    Alert.alert('Sabitlenmiş Mesajlar', 'Henüz sabitlenmiş mesaj yok.');
  };

  const handleSearch = () => {
    if (!exchangeId) return;
    router.push(`/chat/${exchangeId}?search=1`);
  };

  const handleExport = async () => {
    try {
      await Share.share({ message: 'MeetBook sohbet dışa aktarımı' });
    } catch {
      // user cancelled or share unavailable
    }
  };

  const handleReport = () => {
    Alert.alert('Şikayet', 'Şikayet kaydı alındı.', [{ text: 'Tamam' }]);
  };

  const handleBlock = () => {
    Alert.alert(
      'Engelle',
      'Bu kullanıcıyı engellemek istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Engelle',
          style: 'destructive',
          onPress: () => {
            toast.show('Engellendi', { variant: 'success' });
            router.back();
          },
        },
      ],
    );
  };

  const counterpart = exchange?.counterpart;
  const book = exchange?.book;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, ...shadows.card }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Sohbet Bilgisi</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Counterpart profile */}
      {counterpart && (
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.card]}>
          <Avatar name={counterpart.name} size="large" />
          <Text style={[styles.name, { color: colors.text }]}>{counterpart.name}</Text>
          {counterpart.trust && (
            <View style={[styles.trustBadge, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
              <Text style={[styles.trustText, { color: colors.primary }]}>
                Güven Skoru: {counterpart.trust.score}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Shared book */}
      {book && (
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.card]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Takas Kitabı</Text>
          <View style={styles.bookRow}>
            {book.photos?.[0]?.url && (
              <Image source={{ uri: book.photos[0].url }} style={styles.bookCover} />
            )}
            <View style={styles.bookInfo}>
              <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={2}>
                {book.title}
              </Text>
              {book.author && (
                <Text style={[styles.bookAuthor, { color: colors.textMuted }]}>{book.author}</Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Settings */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.card]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Ayarlar</Text>

        {/* Mute */}
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <Ionicons name="notifications-off-outline" size={22} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Sessize Al</Text>
          </View>
          <Switch
            value={settings?.is_muted ?? false}
            onValueChange={handleToggleMute}
            trackColor={{ false: colors.border, true: colors.primary + '50' }}
            thumbColor={settings?.is_muted ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Wallpaper */}
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setShowWallpaperPicker((v) => !v)}
        >
          <View style={styles.settingLeft}>
            <Ionicons name="image-outline" size={22} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Duvar Kağıdı</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {showWallpaperPicker && (
          <View style={styles.wallpaperPicker}>
            {WALLPAPER_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => handleWallpaperPick(opt.colors)}
                style={styles.wallpaperSwatchWrap}
              >
                <LinearGradient
                  colors={opt.colors as [string, string]}
                  style={styles.wallpaperSwatch}
                />
                <Text style={[styles.wallpaperLabel, { color: colors.textMuted }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Font size */}
        <TouchableOpacity style={styles.settingRow} onPress={handleFontSize}>
          <View style={styles.settingLeft}>
            <Ionicons name="text-outline" size={22} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>Yazı Boyutu</Text>
          </View>
          <View style={styles.settingRight}>
            <Text style={[styles.settingValue, { color: colors.textMuted }]}>
              {settings?.font_size === 'small' ? 'Küçük' : settings?.font_size === 'large' ? 'Büyük' : 'Normal'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.card]}>
        <TouchableOpacity style={styles.actionRow} onPress={handleStarred}>
          <Ionicons name="star-outline" size={20} color="#E8A13A" />
          <Text style={[styles.actionText, { color: colors.text }]}>Yıldızlı Mesajlar</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow} onPress={handlePinned}>
          <Ionicons name="pin-outline" size={20} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.text }]}>Sabitlenmiş Mesajlar</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow} onPress={handleSearch}>
          <Ionicons name="search-outline" size={20} color={colors.text} />
          <Text style={[styles.actionText, { color: colors.text }]}>Sohbette Ara</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow} onPress={handleExport}>
          <Ionicons name="download-outline" size={20} color={colors.text} />
          <Text style={[styles.actionText, { color: colors.text }]}>Sohbeti Dışa Aktar</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Danger zone */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.card]}>
        <TouchableOpacity style={styles.dangerRow} onPress={handleReport}>
          <Ionicons name="flag-outline" size={20} color={colors.danger} />
          <Text style={[styles.dangerText, { color: colors.danger }]}>Kullanıcıyı Şikayet Et</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerRow} onPress={handleBlock}>
          <Ionicons name="ban-outline" size={20} color={colors.danger} />
          <Text style={[styles.dangerText, { color: colors.danger }]}>Engelle</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.title, fontWeight: '700' },
  section: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  // Counterpart
  name: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  trustText: { fontSize: fontSize.bodySm, fontWeight: '600' },
  // Book
  bookRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  bookCover: {
    width: 50,
    height: 70,
    borderRadius: radius.input,
    backgroundColor: '#e0e0e0',
  },
  bookInfo: { flex: 1, gap: 4 },
  bookTitle: { fontSize: fontSize.body, fontWeight: '600', lineHeight: 20 },
  bookAuthor: { fontSize: fontSize.caption },
  // Settings
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingLabel: { fontSize: fontSize.body },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settingValue: { fontSize: fontSize.bodySm },
  wallpaperPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  wallpaperSwatchWrap: { alignItems: 'center', gap: spacing.xs },
  wallpaperSwatch: {
    width: 52,
    height: 52,
    borderRadius: radius.input,
  },
  wallpaperLabel: { fontSize: fontSize.caption },
  // Actions
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  actionText: { fontSize: fontSize.body, flex: 1 },
  // Danger
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  dangerText: { fontSize: fontSize.body, flex: 1 },
});
