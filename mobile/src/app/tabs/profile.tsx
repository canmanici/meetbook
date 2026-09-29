import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Share,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, BookCover, Skeleton, palette, pastels, spacing, fontSize, radius, shadows } from '@/components/ui';
import {
  ApiError,
  getMe,
  getUser,
  listMyBooks,
  listExchanges,
  getExchange,
  logout,
  updateGeofenceRadius,
  updateMe,
  uploadAvatar,
} from '@/lib/api/client';
import { BOOK_CATEGORY_LABELS, type BookCategory } from '@/constants/books';
import QuickRadiusSheet from '@/components/map/quick-radius-sheet';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';
import { useToast } from '@/hooks/use-toast';
/** Same cap as the backend (auth/service.py MAX_AVATAR_BYTES). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type PastelName = keyof typeof pastels.light;

const MENU_ITEMS = [
  { key: 'credits', label: 'Kitap Kredim', icon: 'wallet' as const, tint: 'mint' as PastelName, route: '/settings/credits' as const },
  { key: 'courses', label: 'Ders Kitapları', icon: 'school' as const, tint: 'sky' as PastelName, route: '/course-search' as const },
  { key: 'teacher', label: 'Öğretmen Hesabı', icon: 'ribbon' as const, tint: 'butter' as PastelName, route: '/settings/teacher' as const },
  { key: 'user-search', label: 'Kullanıcı Ara', icon: 'search' as const, tint: 'lilac' as PastelName, route: '/search/users' as const },
  { key: 'trusted', label: 'Güvendiğim Kişi', icon: 'shield-checkmark' as const, tint: 'mint' as PastelName, route: '/settings/trusted-contact' as const },
  { key: 'blocked', label: 'Engellenen Kullanıcılar', icon: 'ban' as const, tint: 'coral' as PastelName, route: '/settings/blocked-users' as const },
  { key: 'wishlist', label: 'İstek Listem', icon: 'heart' as const, tint: 'blush' as PastelName, route: '/wishlist' as const },
  { key: 'favorites', label: 'Favorilerim', icon: 'heart' as const, tint: 'coral' as PastelName, route: '/wishlist/favorites' as const },
  { key: 'saved-searches', label: 'Kayıtlı Aramalar', icon: 'bookmark' as const, tint: 'butter' as PastelName, route: '/saved-searches' as const },
  { key: 'clubs', label: 'Kitap Kulüplerim', icon: 'people' as const, tint: 'sky' as PastelName, route: '/chat/club' as const },
  { key: 'yir', label: 'Yılın Özeti', icon: 'sparkles' as const, tint: 'blush' as PastelName, route: '/year-in-review' as const },
  { key: 'settings', label: 'Ayarlar', icon: 'settings-sharp' as const, tint: 'sky' as PastelName, route: '/settings' as const },
] as const;

const CATEGORY_EMOJI: Record<string, string> = {
  fiction: '📖',
  non_fiction: '🧠',
  textbook: '🎓',
  children: '🧸',
  comics: '💥',
  poetry: '🪶',
  other: '📚',
};

const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const TR_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_READING_GOAL = 12;
const readingGoalKey = (year: number) => `reading_goal_${year}`;

function formatStampDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

interface PassportStamp {
  id: string;
  city: string;
  date: string;
  category: string;
  title: string;
}

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const pastel = pastels[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [radiusKm, setRadiusKm] = useState(10);
  const [showRadiusSheet, setShowRadiusSheet] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const setUser = useAuthStore((s) => s.setUser);
  const params = useLocalSearchParams<{ edit?: string }>();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editAvatarUri, setEditAvatarUri] = useState<string | null>(null);
  const [editAvatarType, setEditAvatarType] = useState<'image/jpeg' | 'image/gif'>('image/jpeg');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const autoEditDoneRef = useRef(false);

  const [readingGoal, setReadingGoal] = useState(DEFAULT_READING_GOAL);
  const [goalInput, setGoalInput] = useState('');
  const [showGoalModal, setShowGoalModal] = useState(false);

  const { isLoading: meLoading, data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  // Sync geofence radius & avatar_url from server
  useEffect(() => {
    const r = (meData as any)?.geofence_radius_km;
    if (typeof r === 'number' && r >= 1 && r <= 200) {
      setRadiusKm(r);
    }
    const av = (meData as any)?.avatar_url;
    if (typeof av === 'string') {
      setAvatarUrl(av);
    }
  }, [meData]);

  // Auto-enter edit mode when navigated with ?edit=1
  useEffect(() => {
    if (params.edit === '1' && !autoEditDoneRef.current && user?.name) {
      autoEditDoneRef.current = true;
      setEditName(user.name);
      setEditAvatarUri(null);
      setIsEditing(true);
    }
  }, [params.edit, user?.name]);

  // F04 — load yearly reading goal from AsyncStorage.
  useEffect(() => {
    AsyncStorage.getItem(readingGoalKey(CURRENT_YEAR))
      .then((v) => {
        const n = v ? parseInt(v, 10) : NaN;
        if (Number.isFinite(n) && n > 0) setReadingGoal(n);
      })
      .catch(() => undefined);
  }, []);

  const { data: booksData } = useQuery({
    queryKey: ['books', 'me', 'flat'],
    queryFn: () => listMyBooks(),
  });
  const books = useMemo(() => booksData?.items ?? [], [booksData]);

  const { data: profile } = useQuery({
    queryKey: ['user', user?.id],
    queryFn: () => getUser(user!.id),
    enabled: !!user?.id,
  });

  // F03/F04/F20 — completed exchanges (both roles) for yearly stats, goal & habits.
  const { data: yearlyExchanges } = useQuery({
    queryKey: ['exchanges', 'yearly', user?.id],
    queryFn: async () => {
      const [sent, received] = await Promise.all([
        listExchanges({ role: 'sent', status: 'completed', limit: 50 }),
        listExchanges({ role: 'received', status: 'completed', limit: 50 }),
      ]);
      const seen = new Set<string>();
      const merged = [...sent.items, ...received.items].filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      return merged;
    },
    enabled: !!user?.id,
  });

  // T49 — Book passport: derive stamps from completed exchanges (both roles).
  const { data: stamps } = useQuery<PassportStamp[]>({
    queryKey: ['passport', user?.id],
    queryFn: async () => {
      const [received, sent] = await Promise.all([
        listExchanges({ role: 'received', status: 'completed', limit: 50 }),
        listExchanges({ role: 'sent', status: 'completed', limit: 50 }),
      ]);
      const seen = new Set<string>();
      const summaries = [...received.items, ...sent.items].filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      const details = await Promise.all(
        summaries.map((s) => getExchange(s.id).catch(() => null)),
      );
      return summaries.map((s, i) => {
        const meetup = details[i]?.meetup;
        return {
          id: s.id,
          city: meetup?.place_name || 'Bilinmeyen',
          date: s.created_at,
          category: s.book.category,
          title: s.book.title,
        };
      });
    },
    enabled: !!user?.id,
  });

  // T50 — Reading identity card: category breakdown.
  const identity = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const b of books as any[]) {
      const c = (b.category || 'other') as string;
      counts[c] = (counts[c] || 0) + 1;
      total++;
    }
    const entries = Object.entries(counts)
      .map(([cat, n]) => ({
        cat: cat as BookCategory,
        n,
        pct: total ? Math.round((n / total) * 100) : 0,
      }))
      .sort((a, b) => b.n - a.n);
    return { entries, total };
  }, [books]);

  // F03/F04/F20 — derive yearly stats, streak & habits from completed exchanges.
  const yearlyStats = useMemo(() => {
    const all = (yearlyExchanges ?? []) as any[];
    const thisYear = all.filter((e) => {
      const d = new Date(e.updated_at);
      return !isNaN(d.getTime()) && d.getFullYear() === CURRENT_YEAR;
    });

    // F03 — Kitap: completed exchanges this year.
    const bookCount = thisYear.length;

    // F03 — Kilometre: sum of distance_km when the field is available.
    let kmTotal = 0;
    let kmAvailable = false;
    for (const e of thisYear) {
      const km = (e as any).distance_km;
      if (typeof km === 'number' && km >= 0) {
        kmTotal += km;
        kmAvailable = true;
      }
    }

    // F03 — Kişi: unique counterpart ids met this year.
    const counterparts = new Set<string>();
    for (const e of thisYear) {
      if (e.counterpart?.id) counterparts.add(e.counterpart.id);
    }

    // F04 — Streak: consecutive months (back from current) with ≥1 completed exchange.
    const monthsActive = new Set<string>();
    for (const e of all) {
      const d = new Date(e.updated_at);
      if (!isNaN(d.getTime())) monthsActive.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    let streak = 0;
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth();
    while (monthsActive.has(`${y}-${m}`)) {
      streak += 1;
      m -= 1;
      if (m < 0) {
        m = 11;
        y -= 1;
      }
    }

    // F20 — Day-of-week & category breakdown (this year).
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const catCounts: Record<string, number> = {};
    for (const e of thisYear) {
      const d = new Date(e.updated_at);
      if (!isNaN(d.getTime())) dayCounts[d.getDay()] += 1;
      const c = (e.book?.category ?? 'other') as string;
      catCounts[c] = (catCounts[c] || 0) + 1;
    }
    const dayMax = Math.max(1, ...dayCounts);
    const dayEntries = TR_DAYS.map((label, i) => ({
      label,
      count: dayCounts[i],
      pct: Math.round((dayCounts[i] / dayMax) * 100),
    }));
    const topDayIdx = dayCounts.reduce((best, c, i) => (c > dayCounts[best] ? i : best), 0);

    const catEntries = Object.entries(catCounts)
      .map(([cat, n]) => ({ cat: cat as BookCategory, n }))
      .sort((a, b) => b.n - a.n);
    const catMax = Math.max(1, ...catEntries.map((c) => c.n));
    const catTotal = thisYear.length;

    return {
      bookCount,
      kmTotal: kmAvailable ? Math.round(kmTotal) : null,
      peopleCount: counterparts.size,
      streak,
      dayEntries,
      topDayLabel: TR_DAYS[topDayIdx],
      topDayCount: dayCounts[topDayIdx],
      catEntries: catEntries.map((c) => ({
        ...c,
        pct: Math.round((c.n / catMax) * 100),
        sharePct: catTotal ? Math.round((c.n / catTotal) * 100) : 0,
      })),
      catTotal,
    };
  }, [yearlyExchanges]);

  const handleLogout = async () => {
    try {
      await logout({ refresh_token: refreshToken ?? '' });
    } catch { /* best-effort */ }
    await clearTokens();
    clearSession();
    router.replace('/auth/login');
  };

  const enterEdit = () => {
    setEditName(user?.name ?? '');
    setEditUsername(user?.username ?? '');
    setEditAvatarUri(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditName('');
    setEditUsername('');
    setEditAvatarUri(null);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show('Galeri izni gerekli', { variant: 'error' });
      return;
    }
    // No picker crop editor: it re-encodes to JPEG, which would freeze an
    // animated GIF. GIFs upload as-is; photos get a centred square crop.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const isGif = asset.mimeType === 'image/gif' || /\.gif$/i.test(asset.fileName ?? asset.uri);
    if (isGif) {
      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
        toast.show('GIF en fazla 5 MB olabilir', { variant: 'error' });
        return;
      }
      setEditAvatarUri(asset.uri);
      setEditAvatarType('image/gif');
      return;
    }
    try {
      // Square-crop the centre and shrink to 512 px (also drops metadata).
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const side = Math.min(asset.width, asset.height);
      const cropped = await manipulateAsync(
        asset.uri,
        [
          {
            crop: {
              originX: Math.floor((asset.width - side) / 2),
              originY: Math.floor((asset.height - side) / 2),
              width: side,
              height: side,
            },
          },
          { resize: { width: Math.min(side, 512) } },
        ],
        { compress: 0.85, format: SaveFormat.JPEG },
      );
      setEditAvatarUri(cropped.uri);
    } catch {
      setEditAvatarUri(asset.uri);
    }
    setEditAvatarType('image/jpeg');
  };

  const saveProfile = async () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('İsim boş olamaz', { variant: 'error' });
      return;
    }
    const trimmedUsername = editUsername.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('Kullanıcı adı en az 3 karakter olmalı (harf, rakam, _)', { variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      // Update name + username first
      const me = await updateMe({ name: trimmed, username: trimmedUsername } as any);

      // Upload avatar if a new one was picked
      let newAvatarUrl = (me as any)?.avatar_url ?? avatarUrl;
      if (editAvatarUri) {
        try {
          const result = await uploadAvatar(editAvatarUri, editAvatarType);
          newAvatarUrl = result.avatar_url;
          setAvatarUrl(newAvatarUrl);
        } catch (e) {
          console.warn('[profile] avatar upload failed:', e);
          const code = (e as { body?: { detail?: string } })?.body?.detail;
          const reason =
            code === 'TOO_MANY_FRAMES' ? 'GIF çok uzun (en fazla 300 kare).'
            : code === 'IMAGE_TOO_LARGE' ? 'Görsel çok büyük.'
            : code === 'FILE_TOO_LARGE' ? 'Dosya 5 MB’dan büyük.'
            : code === 'INVALID_IMAGE_FORMAT' || code === 'INVALID_IMAGE' ? 'Desteklenmeyen görsel.'
            : null;
          toast.show(
            reason ? `Fotoğraf yüklenemedi: ${reason}` : 'Fotoğraf yüklenemedi ama profil güncellendi',
            { variant: 'info' },
          );
        }
      }

      // Sync auth store
      if (user) setUser({ ...user, name: trimmed, username: trimmedUsername, avatarUrl: newAvatarUrl });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      if (user?.id) await queryClient.invalidateQueries({ queryKey: ['user', user.id] });
      setIsEditing(false);
      setEditAvatarUri(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show('Profil güncellendi', { variant: 'success' });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err instanceof ApiError && err.status === 409) {
        toast.show('Bu kullanıcı adı alınmış', { variant: 'error' });
      } else {
        toast.show('Profil güncellenemedi', { variant: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const shareIdentity = () => {
    if (identity.total === 0) {
      toast.show('Paylaşılacak kitap yok', { variant: 'error' });
      return;
    }
    const lines = identity.entries.map(
      (e) => `${BOOK_CATEGORY_LABELS[e.cat] ?? e.cat}: %${e.pct}`,
    );
    Share.share({
      message: `${displayName}'in okuma kimliği\n${lines.join('\n')}\nMeetBook`,
    });
  };

  // F04 — reading goal editing.
  const openGoalEditor = () => {
    setGoalInput(String(readingGoal));
    setShowGoalModal(true);
  };

  const saveGoal = async () => {
    const n = parseInt(goalInput, 10);
    if (!Number.isFinite(n) || n <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('Geçerli bir sayı gir', { variant: 'error' });
      return;
    }
    setReadingGoal(n);
    setShowGoalModal(false);
    try {
      await AsyncStorage.setItem(readingGoalKey(CURRENT_YEAR), String(n));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show('Hedef kaydedildi', { variant: 'success' });
    } catch {
      // AsyncStorage unavailable (e.g. Expo Go) — value kept in memory only.
    }
  };

  if (meLoading && !user) {
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
    ? ['#1C403A', '#10231F']
    : ['#15917A', '#0C5E50'];

  const identityGradient: [string, string] = isDark
    ? ['#3A2A6B', '#1B1338']
    : ['#6B4EE0', '#3A1F8C'];

  const stats = [
    { value: profile?.completed_exchanges ?? 0, label: 'takas', icon: 'swap-horizontal' as const },
    { value: books.length, label: 'kitap', icon: 'library' as const },
    {
      value: profile && profile.rating_count > 0 ? profile.rating_average.toFixed(1) : '—',
      label: 'puan',
      icon: 'star' as const,
    },
  ];

  // Chunk books into rows of 2 for the shelf grid.
  const bookRows: any[][] = [];
  for (let i = 0; i < books.length; i += 2) {
    bookRows.push((books as any[]).slice(i, i + 2));
  }

  const passportStamps = stamps ?? [];
  const uniqueCities = new Set(passportStamps.map((s) => s.city));

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
        style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}
      >
        {!isEditing ? (
          <TouchableOpacity
            style={[styles.editBtn, { top: insets.top + spacing.sm }]}
            onPress={enterEdit}
            hitSlop={8}
            activeOpacity={0.7}
            testID="profile-edit-button"
          >
            <Ionicons name="create-outline" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={[styles.editActions, { top: insets.top + spacing.sm }]}>
            <TouchableOpacity
              style={[styles.editActionBtn, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
              onPress={cancelEdit}
              hitSlop={8}
              disabled={isSaving}
              activeOpacity={0.7}
              testID="profile-cancel-button"
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editActionBtn, { backgroundColor: 'rgba(255,255,255,0.92)' }]}
              onPress={saveProfile}
              hitSlop={8}
              disabled={isSaving}
              activeOpacity={0.7}
              testID="profile-save-button"
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={gradientColors[0]} />
              ) : (
                <Ionicons name="checkmark" size={22} color={gradientColors[0]} />
              )}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.heroAvatar}
          onPress={isEditing ? pickAvatar : undefined}
          activeOpacity={0.85}
          disabled={!isEditing}
        >
          <Avatar
            name={isEditing ? (editName || ' ') : displayName}
            imageUrl={isEditing ? (editAvatarUri ?? avatarUrl) : avatarUrl}
            size="large"
            verified={false}
          />
          {isEditing && (
            <View style={styles.avatarCameraBadge}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          )}
        </TouchableOpacity>

        {isEditing ? (
          <>
            <TextInput
              style={styles.heroNameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="İsim"
              placeholderTextColor="rgba(255,255,255,0.6)"
              maxLength={60}
              testID="profile-name-input"
            />
            <TextInput
              style={styles.heroUsernameInput}
              value={editUsername}
              onChangeText={(v) => setEditUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="kullaniciadi"
              placeholderTextColor="rgba(255,255,255,0.5)"
              maxLength={30}
              testID="profile-username-input"
            />
          </>
        ) : (
          <Text style={styles.heroName}>{displayName}</Text>
        )}
        {!isEditing && !!user?.username && (
          <Text style={styles.heroUsername}>@{user.username}</Text>
        )}
        <Text style={styles.heroEmail}>{displayEmail}</Text>
      </LinearGradient>

      {meData?.email_verified === false && (
        <TouchableOpacity
          onPress={() => router.push('/verify-email')}
          style={[styles.verifyBanner, { backgroundColor: colors.warning + '1F', borderColor: colors.warning }]}
          testID="profile-verify-banner"
          accessibilityRole="button"
        >
          <Ionicons name="mail-unread-outline" size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.verifyTitle, { color: colors.text }]}>E-postanı doğrula</Text>
            <Text style={[styles.verifySub, { color: colors.textMuted }]}>
              Kitap eklemek ve takas yapmak için e-postana gelen kodu gir.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Stats — overlap the hero for depth */}
      <View style={styles.statsRow}>
        {stats.map((stat) => (
          <View key={stat.label} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
            <Ionicons name={stat.icon} size={18} color={colors.primary} />
            <Text style={styles.statText}>
              <Text style={[styles.statValue, { color: colors.text }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{' '}{stat.label}</Text>
            </Text>
          </View>
        ))}
      </View>

      {typeof meData?.credit_balance === 'number' && (
        <TouchableOpacity
          onPress={() => router.push('/settings/credits' as any)}
          style={[styles.creditCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}
          testID="profile-credit-card"
          accessibilityRole="button"
          accessibilityLabel={`Kitap kredin: ${meData.credit_balance}`}
        >
          <View style={[styles.creditIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="wallet" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.verifyTitle, { color: colors.text }]}>
              {meData.credit_balance} kitap kredisi
            </Text>
            <Text style={[styles.verifySub, { color: colors.textMuted }]}>
              {meData.edu_verified
                ? 'Öğrenci doğrulandı · kitap ver, kredi kazan'
                : 'Öğrenci misin? Öğretmeninden aldığın kodla doğrula'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* F03 — Yearly reading stats */}
      <View style={styles.yearlySection}>
        <Text style={[styles.yearlyHeader, { color: colors.text }]}>Bu yıl</Text>
        <View style={styles.yearlyStatsRow}>
          <View style={[styles.yearlyCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
            <Ionicons name="book" size={18} color={colors.primary} />
            <Text style={[styles.yearlyStatValue, { color: colors.text }]}>{yearlyStats.bookCount}</Text>
            <Text style={[styles.yearlyStatLabel, { color: colors.textMuted }]}>Kitap</Text>
          </View>
          <View style={[styles.yearlyCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
            <Ionicons name="navigate" size={18} color={colors.primary} />
            <Text style={[styles.yearlyStatValue, { color: colors.text }]}>
              {yearlyStats.kmTotal !== null ? `${yearlyStats.kmTotal}` : '—'}
            </Text>
            <Text style={[styles.yearlyStatLabel, { color: colors.textMuted }]}>Kilometre</Text>
          </View>
          <View style={[styles.yearlyCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
            <Ionicons name="people" size={18} color={colors.primary} />
            <Text style={[styles.yearlyStatValue, { color: colors.text }]}>{yearlyStats.peopleCount}</Text>
            <Text style={[styles.yearlyStatLabel, { color: colors.textMuted }]}>Kişi</Text>
          </View>
        </View>
      </View>

      {/* F04 — Reading goal & streak */}
      <View style={[styles.goalCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
        <View style={styles.goalHeader}>
          <View style={styles.goalTitleRow}>
            <View style={[styles.goalIconChip, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="flag" size={16} color={colors.primary} />
            </View>
            <View>
              <Text style={[styles.goalTitle, { color: colors.text }]}>Okuma Hedefi</Text>
              <Text style={[styles.goalSub, { color: colors.textMuted }]}>
                {yearlyStats.bookCount} / {readingGoal} kitap
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.goalEditBtn, { backgroundColor: colors.primarySoft }]}
            onPress={openGoalEditor}
            activeOpacity={0.7}
            hitSlop={8}
            testID="edit-reading-goal-button"
          >
            <Ionicons name="create-outline" size={14} color={colors.primary} />
            <Text style={[styles.goalEditText, { color: colors.primary }]}>Düzenle</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.goalBarTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.goalBarFill,
              {
                width: `${Math.min(100, readingGoal > 0 ? (yearlyStats.bookCount / readingGoal) * 100 : 0)}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>

        <View style={styles.goalFooter}>
          <Text style={[styles.goalPct, { color: colors.text }]}>
            %{readingGoal > 0 ? Math.min(100, Math.round((yearlyStats.bookCount / readingGoal) * 100)) : 0}
          </Text>
          <View style={styles.streakBadge}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <Text style={[styles.streakText, { color: colors.text }]}>
              {yearlyStats.streak} ay
            </Text>
          </View>
        </View>
      </View>

      {/* F20 — Reading habits dashboard */}
      <View style={[styles.habitsCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
        <View style={styles.habitsHeader}>
          <View style={styles.habitsTitleRow}>
            <View style={[styles.habitsIconChip, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="bar-chart" size={16} color={colors.primary} />
            </View>
            <Text style={[styles.habitsTitle, { color: colors.text }]}>Okuma Alışkanlıkları</Text>
          </View>
        </View>

        {yearlyStats.catTotal === 0 ? (
          <Text style={[styles.habitsEmpty, { color: colors.textMuted }]}>
            Bu yıl tamamlanan takas yok
          </Text>
        ) : (
          <>
            <Text style={[styles.habitsSectionLabel, { color: colors.textMuted }]}>
              En aktif gün:{' '}
              <Text style={{ color: colors.text, fontWeight: '800' }}>
                {yearlyStats.topDayLabel}
              </Text>
            </Text>
            <View style={styles.habitsBars}>
              {yearlyStats.dayEntries.map((d) => (
                <View key={d.label} style={styles.habitsBarCol}>
                  <View style={[styles.habitsBarTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.habitsBarFill,
                        {
                          width: `${Math.max(d.pct, d.count > 0 ? 6 : 0)}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.habitsBarLabel, { color: colors.textMuted }]}>{d.label}</Text>
                </View>
              ))}
            </View>

            <Text style={[styles.habitsSectionLabel, { color: colors.textMuted, marginTop: spacing.md }]}>
              En çok:{' '}
              <Text style={{ color: colors.text, fontWeight: '800' }}>
                {yearlyStats.catEntries[0]
                  ? (BOOK_CATEGORY_LABELS[yearlyStats.catEntries[0].cat] ?? yearlyStats.catEntries[0].cat)
                  : '—'}
              </Text>
            </Text>
            <View style={styles.habitsCatBars}>
              {yearlyStats.catEntries.slice(0, 4).map((c) => (
                <View key={c.cat} style={styles.habitsCatRow}>
                  <Text style={[styles.habitsCatLabel, { color: colors.text }]}>
                    {CATEGORY_EMOJI[c.cat] ?? '📚'} {BOOK_CATEGORY_LABELS[c.cat] ?? c.cat}
                  </Text>
                  <View style={[styles.habitsCatTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.habitsCatFill,
                        { width: `${Math.max(c.pct, 4)}%`, backgroundColor: colors.primary },
                      ]}
                    />
                  </View>
                  <Text style={[styles.habitsCatPct, { color: colors.textMuted }]}>{c.sharePct}%</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* T50 — Reading identity card */}
      <View style={styles.identityWrap}>
        <LinearGradient
          colors={identityGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.identityCard}
        >
          <View style={styles.identityHeader}>
            <View style={styles.identityTitleRow}>
              <View style={styles.identityIconBadge}>
                <Ionicons name="book" size={18} color="#fff" />
              </View>
              <View>
                <Text style={styles.identityTitle}>Okuma Kimliğim</Text>
                <Text style={styles.identitySub}>
                  {identity.total} kitap · {identity.entries.length} tür
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.identityShareBtn}
              onPress={shareIdentity}
              activeOpacity={0.7}
              hitSlop={8}
              testID="share-identity-button"
            >
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.identityShareText}>Paylaş</Text>
            </TouchableOpacity>
          </View>

          {identity.total === 0 ? (
            <Text style={styles.identityEmpty}>
              Kitap ekledikçe okuma kimliğin oluşur
            </Text>
          ) : (
            <>
              <View style={styles.identityTop}>
                <Text style={styles.identityBigPct}>
                  {identity.entries[0].pct}%
                </Text>
                <Text style={styles.identityTopLabel}>
                  {BOOK_CATEGORY_LABELS[identity.entries[0].cat]}
                </Text>
              </View>
              <View style={styles.identityBars}>
                {identity.entries.slice(0, 5).map((e) => (
                  <View key={e.cat} style={styles.identityBarRow}>
                    <Text style={styles.identityBarLabel}>
                      {CATEGORY_EMOJI[e.cat] ?? '📚'} {BOOK_CATEGORY_LABELS[e.cat] ?? e.cat}
                    </Text>
                    <View style={styles.identityBarTrack}>
                      <View
                        style={[
                          styles.identityBarFill,
                          { width: `${Math.max(e.pct, 4)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.identityBarPct}>{e.pct}%</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </LinearGradient>
      </View>

      {/* T38 — Bookshelf grid */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitaplığım</Text>
        <TouchableOpacity
          testID="add-book-button"
          style={[styles.addBtn, { backgroundColor: colors.primary }, shadows.float, { shadowColor: colors.primary }]}
          onPress={() => router.push('/book/new')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Ekle</Text>
        </TouchableOpacity>
      </View>

      {books.length === 0 ? (
        <View style={[styles.emptyBooks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="book-outline" size={26} color={colors.primary} />
          </View>
          <Text style={[styles.emptyText, { color: colors.text }]}>Henüz kitap eklenmedi</Text>
          <Text style={[styles.emptySub, { color: colors.textMuted }]}>
            İlk kitabını ekle, takasa başla
          </Text>
        </View>
      ) : (
        <View style={styles.shelfWrap}>
          {bookRows.map((row, ri) => (
            <View key={ri} style={styles.shelfRow}>
              {row.map((book) => (
                <TouchableOpacity
                  key={book.id}
                  testID={`book-cell-${book.id}`}
                  style={[
                    styles.shelfCell,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    shadows.card,
                  ]}
                  onPress={() => router.push(`/book/${book.id}`)}
                  activeOpacity={0.75}
                >
                  <View style={styles.shelfCoverBox}>
                    <BookCover url={book.photos?.[0]?.url} size={120} radius={radius.input} />
                    <View
                      style={[
                        styles.shelfAvailBadge,
                        { backgroundColor: book.is_available ? colors.success : colors.warning },
                      ]}
                    >
                      <Text style={styles.shelfAvailText}>
                        {book.is_available ? 'Mevcut' : 'Takasta'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.shelfTitle, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {book.title}
                  </Text>
                  {book.author ? (
                    <Text
                      style={[styles.shelfAuthor, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {book.author}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
              {row.length === 1 && <View style={styles.shelfSpacer} />}
            </View>
          ))}
        </View>
      )}

      {/* T49 — Book passport */}
      <View style={styles.passportWrap}>
        <View style={styles.passportHeader}>
          <View style={styles.passportTitleRow}>
            <Ionicons name="airplane" size={18} color={colors.primary} />
            <Text style={[styles.passportTitle, { color: colors.text }]}>Kitap Pasaportu</Text>
          </View>
          <Text style={[styles.passportCount, { color: colors.textMuted }]}>
            {uniqueCities.size} şehir · {passportStamps.length} kitap
          </Text>
        </View>

        {passportStamps.length === 0 ? (
          <View
            style={[styles.passportEmpty, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="compass-outline" size={26} color={colors.textMuted} />
            <Text style={[styles.passportEmptyText, { color: colors.text }]}>
              Tamamlanan takas yok
            </Text>
            <Text style={[styles.passportEmptySub, { color: colors.textMuted }]}>
              Takas tamamladıkça damga biriktir
            </Text>
          </View>
        ) : (
          <View style={styles.stampsGrid}>
            {passportStamps.map((s, i) => {
              const angle = (i % 2 === 0 ? -1 : 1) * (2 + (i % 3));
              return (
                <View
                  key={s.id}
                  style={[
                    styles.stamp,
                    {
                      borderColor: colors.primary + 'AA',
                      backgroundColor: colors.surface,
                      transform: [{ rotate: `${angle}deg` }],
                    },
                  ]}
                >
                  <Text style={styles.stampEmoji}>{CATEGORY_EMOJI[s.category] ?? '📚'}</Text>
                  <Text
                    style={[styles.stampCity, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {s.city}
                  </Text>
                  <Text style={[styles.stampDate, { color: colors.textMuted }]}>
                    {formatStampDate(s.date)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Menu — secondary, smaller */}
      <View
        style={[
          styles.menuCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {MENU_ITEMS.map((item, idx) => (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.menuItem,
              idx < MENU_ITEMS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
            onPress={() => item.route && router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconChip, { backgroundColor: pastel[item.tint].bg }]}>
              <Ionicons name={item.icon} size={15} color={pastel[item.tint].ink} />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Geofence radius */}
      <TouchableOpacity
        style={[styles.geofenceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowRadiusSheet(true)}
        activeOpacity={0.7}
      >
        <View style={[styles.geofenceIconChip, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="location-outline" size={17} color={colors.primary} />
        </View>
        <Text style={[styles.geofenceLabel, { color: colors.text }]}>Bildirim Alanı</Text>
        <Text style={[styles.geofenceValue, { color: colors.primary }]}>{radiusKm} km</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Radius sheet modal */}
      <Modal
        visible={showRadiusSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRadiusSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <QuickRadiusSheet
              currentRadiusKm={radiusKm}
              onRadiusChange={async (km) => {
                const prev = radiusKm;
                setRadiusKm(km); // optimistic
                try {
                  await updateGeofenceRadius(km);
                  toast.show('Bildirim alanı güncellendi', { variant: 'success' });
                  queryClient.invalidateQueries({ queryKey: ['me'] });
                } catch {
                  setRadiusKm(prev); // revert optimistic update
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  toast.show('Güncelleme başarısız', { variant: 'error' });
                }
              }}
              onClose={() => setShowRadiusSheet(false)}
            />
          </View>
        </View>
      </Modal>

      {/* F04 — Goal edit modal */}
      <Modal
        visible={showGoalModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowGoalModal(false)}
      >
        <View style={styles.goalModalOverlay}>
          <View style={[styles.goalModalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.goalModalTitle, { color: colors.text }]}>Okuma Hedefi</Text>
            <Text style={[styles.goalModalSub, { color: colors.textMuted }]}>
              {CURRENT_YEAR} yılı için hedefin
            </Text>
            <TextInput
              style={[styles.goalModalInput, { color: colors.text, borderColor: colors.border }]}
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder="örn. 24"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              autoFocus
              testID="reading-goal-input"
            />
            <View style={styles.goalModalActions}>
              <TouchableOpacity
                style={[styles.goalModalBtn, { borderColor: colors.border }]}
                onPress={() => setShowGoalModal(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.goalModalBtnText, { color: colors.textMuted }]}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.goalModalBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={saveGoal}
                activeOpacity={0.7}
                testID="save-reading-goal-button"
              >
                <Text style={styles.goalModalBtnTextPrimary}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <TouchableOpacity
        style={[styles.logoutBtn, { backgroundColor: colors.danger + '14' }]}
        onPress={handleLogout}
        activeOpacity={0.7}
        testID="logout-button"
      >
        <Ionicons name="log-out-outline" size={19} color={colors.danger} />
        <Text style={[styles.logoutText, { color: colors.danger }]}>Çıkış Yap</Text>
      </TouchableOpacity>

      <Text style={[styles.footer, { color: colors.textMuted }]}>MeetBook v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  creditCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  creditIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  verifyTitle: { fontSize: fontSize.bodySm, fontWeight: '800' },
  verifySub: { fontSize: fontSize.caption, marginTop: 2 },
  container: {
    flex: 1,
  },
  loadingContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  hero: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl + spacing.md,
    alignItems: 'center',
    borderBottomLeftRadius: radius.sheet + 8,
    borderBottomRightRadius: radius.sheet + 8,
  },
  heroAvatar: {
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: radius.pill,
    padding: 3,
  },
  editBtn: {
    position: 'absolute',
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editActions: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editActionBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroNameInput: {
    width: 260,
    fontSize: fontSize.heading,
    fontWeight: '900',
    color: '#fff',
    marginTop: spacing.md,
    letterSpacing: -0.3,
    textAlign: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.6)',
    paddingBottom: 4,
  },
  heroUsernameInput: {
    width: 200,
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    marginTop: spacing.sm,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.4)',
    paddingBottom: 3,
  },
  heroName: {
    fontSize: fontSize.heading,
    fontWeight: '900',
    color: '#fff',
    marginTop: spacing.md,
    letterSpacing: -0.3,
  },
  heroUsername: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  heroEmail: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginTop: -spacing.xxl,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  statText: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: fontSize.title,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },

  // --- F03/F04/F20: Yearly stats, goal & habits ---
  yearlySection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  yearlyHeader: {
    fontSize: fontSize.title,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  yearlyStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  yearlyCard: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  yearlyStatValue: {
    fontSize: fontSize.title,
    fontWeight: '900',
  },
  yearlyStatLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },

  goalCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  goalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  goalIconChip: {
    width: 34,
    height: 34,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalTitle: {
    fontSize: fontSize.body,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  goalSub: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: 1,
  },
  goalEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  goalEditText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  goalBarTrack: {
    height: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  goalBarFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  goalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  goalPct: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakEmoji: {
    fontSize: 16,
  },
  streakText: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },

  habitsCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  habitsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  habitsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  habitsIconChip: {
    width: 34,
    height: 34,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  habitsTitle: {
    fontSize: fontSize.body,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  habitsEmpty: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  habitsSectionLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  habitsBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
    height: 64,
  },
  habitsBarCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  habitsBarTrack: {
    width: '100%',
    height: 40,
    borderRadius: radius.pill,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  habitsBarFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  habitsBarLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  habitsCatBars: {
    gap: spacing.sm,
  },
  habitsCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  habitsCatLabel: {
    width: 110,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  habitsCatTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  habitsCatFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  habitsCatPct: {
    width: 34,
    textAlign: 'right',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },

  // --- F04: Goal edit modal ---
  goalModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  goalModalCard: {
    width: '100%',
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  goalModalTitle: {
    fontSize: fontSize.title,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  goalModalSub: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: spacing.md,
  },
  goalModalInput: {
    borderWidth: 1,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  goalModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  goalModalBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.button,
    borderWidth: 1,
    alignItems: 'center',
  },
  goalModalBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  goalModalBtnTextPrimary: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },

  // --- T50: Reading identity card ---
  identityWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...shadows.float,
  },
  identityCard: {
    padding: spacing.lg,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  identityTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  identityIconBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.field,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  identityTitle: {
    fontSize: fontSize.body,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.2,
  },
  identitySub: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  identityShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  identityShareText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  identityEmpty: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  identityTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  identityBigPct: {
    fontSize: fontSize.display,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -1,
  },
  identityTopLabel: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.9)',
  },
  identityBars: {
    gap: spacing.sm,
  },
  identityBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  identityBarLabel: {
    width: 110,
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
  },
  identityBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  identityBarFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: '#fff',
  },
  identityBarPct: {
    width: 34,
    textAlign: 'right',
    fontSize: fontSize.caption,
    fontWeight: '800',
    color: '#fff',
  },

  // --- T38: Bookshelf grid ---
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  addBtnText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  emptyBooks: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  emptySub: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    marginTop: 2,
  },
  shelfWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  shelfRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  shelfCell: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  shelfSpacer: {
    flex: 1,
  },
  shelfCoverBox: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  shelfAvailBadge: {
    marginTop: -14,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
  shelfAvailText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  shelfTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
    lineHeight: 17,
  },
  shelfAuthor: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    marginTop: 2,
  },

  // --- T49: Book passport ---
  passportWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  passportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  passportTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  passportTitle: {
    fontSize: fontSize.title,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  passportCount: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  passportEmpty: {
    paddingVertical: spacing.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  passportEmptyText: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  passportEmptySub: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  stampsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stamp: {
    width: '46%',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.field,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  stampEmoji: {
    fontSize: 26,
  },
  stampCity: {
    fontSize: fontSize.bodySm,
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  stampDate: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },

  // --- Menu (secondary, smaller) ---
  menuCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  menuIconChip: {
    width: 30,
    height: 30,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.button,
  },
  logoutText: {
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  footer: {
    textAlign: 'center',
    fontSize: fontSize.caption,
    fontWeight: '500',
    marginTop: spacing.xl,
  },
  geofenceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  geofenceIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  geofenceLabel: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  geofenceValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
});
