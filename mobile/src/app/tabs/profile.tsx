import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Share,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, BookCover, Skeleton, palette, pastels, spacing, fontSize, radius, shadows } from '@/components/ui';
import {
  getMe,
  getUser,
  listMyBooks,
  listExchanges,
  getExchange,
  logout,
  updateGeofenceRadius,
  updateMe,
} from '@/lib/api/client';
import { BOOK_CATEGORY_LABELS, type BookCategory } from '@/constants/books';
import QuickRadiusSheet from '@/components/map/quick-radius-sheet';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';
import { useToast } from '@/hooks/use-toast';

type PastelName = keyof typeof pastels.light;

const MENU_ITEMS = [
  { key: 'trusted', label: 'Güvendiğim Kişi', icon: 'shield-checkmark' as const, tint: 'mint' as PastelName, route: '/settings/trusted-contact' as const },
  { key: 'blocked', label: 'Engellenen Kullanıcılar', icon: 'ban' as const, tint: 'coral' as PastelName, route: '/settings/blocked-users' as const },
  { key: 'wishlist', label: 'İstek Listem', icon: 'heart' as const, tint: 'blush' as PastelName, route: '/wishlist' as const },
  { key: 'yir', label: 'Yılın Özeti', icon: 'sparkles' as const, tint: 'blush' as PastelName, route: '/year-in-review' as const },
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
  const [editAvatarUri, setEditAvatarUri] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const autoEditDoneRef = useRef(false);

  const { isLoading: meLoading, data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  // Sync geofence radius from server
  useEffect(() => {
    const r = (meData as any)?.geofence_radius_km;
    if (typeof r === 'number' && r >= 1 && r <= 100) {
      setRadiusKm(r);
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

  const { data: booksData } = useQuery({
    queryKey: ['books', 'me'],
    queryFn: () => listMyBooks(),
  });
  const books = booksData?.items ?? [];

  const { data: profile } = useQuery({
    queryKey: ['user', user?.id],
    queryFn: () => getUser(user!.id),
    enabled: !!user?.id,
  });

  // T49 — Book passport: derive stamps from completed exchanges (both roles).
  const { data: stamps } = useQuery<PassportStamp[]>({
    queryKey: ['passport', user?.id],
    queryFn: async () => {
      const [received, sent] = await Promise.all([
        listExchanges({ role: 'received', status: 'completed', limit: 100 }),
        listExchanges({ role: 'sent', status: 'completed', limit: 100 }),
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
    setEditAvatarUri(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditName('');
    setEditAvatarUri(null);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show('Galeri izni gerekli', { variant: 'error' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets?.[0]) {
      setEditAvatarUri(result.assets[0].uri);
    }
  };

  const saveProfile = async () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('İsim boş olamaz', { variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      await updateMe({ name: trimmed } as any);
      if (editAvatarUri) {
        console.warn('[profile] avatar upload endpoint not available — keeping URI locally');
        setAvatarUrl(editAvatarUri);
      }
      if (user) setUser({ ...user, name: trimmed });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      if (user?.id) await queryClient.invalidateQueries({ queryKey: ['user', user.id] });
      setIsEditing(false);
      setEditAvatarUri(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show('Profil güncellendi', { variant: 'success' });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show('Profil güncellenemedi', { variant: 'error' });
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
          <TextInput
            style={styles.heroNameInput}
            value={editName}
            onChangeText={setEditName}
            placeholder="İsim"
            placeholderTextColor="rgba(255,255,255,0.6)"
            maxLength={60}
            testID="profile-name-input"
          />
        ) : (
          <Text style={styles.heroName}>{displayName}</Text>
        )}
        <Text style={styles.heroEmail}>{displayEmail}</Text>
      </LinearGradient>

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
  heroName: {
    fontSize: fontSize.heading,
    fontWeight: '900',
    color: '#fff',
    marginTop: spacing.md,
    letterSpacing: -0.3,
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
