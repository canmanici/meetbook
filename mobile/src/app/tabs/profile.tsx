import { useState, useEffect, useRef } from 'react';
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
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Skeleton, palette, pastels, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getMe, getUser, listMyBooks, logout, updateGeofenceRadius, updateMe } from '@/lib/api/client';
import QuickRadiusSheet from '@/components/map/quick-radius-sheet';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';
import { useToast } from '@/hooks/use-toast';

type PastelName = keyof typeof pastels.light;

const MENU_ITEMS = [
  { key: 'trusted', label: 'Güvendiğim Kişi', icon: 'shield-checkmark' as const, tint: 'mint' as PastelName, route: '/settings/trusted-contact' as const },
  { key: 'blocked', label: 'Engellenen Kullanıcılar', icon: 'ban' as const, tint: 'coral' as PastelName, route: '/settings/blocked-users' as const },
  { key: 'wishlist', label: 'İstek Listem', icon: 'heart' as const, tint: 'blush' as PastelName, route: '/wishlist' as const },
  { key: 'settings', label: 'Ayarlar', icon: 'settings-sharp' as const, tint: 'sky' as PastelName, route: '/settings' as const },
] as const;

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

  const stats = [
    { value: profile?.completed_exchanges ?? 0, label: 'takas', icon: 'swap-horizontal' as const },
    { value: books.length, label: 'kitap', icon: 'library' as const },
    {
      value: profile && profile.rating_count > 0 ? profile.rating_average.toFixed(1) : '—',
      label: 'puan',
      icon: 'star' as const,
    },
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

      {/* My books */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitaplarım</Text>
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
        <View style={[styles.booksCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {books.map((book, idx) => (
            <TouchableOpacity
              key={book.id}
              testID={`book-row-${book.id}`}
              style={[
                styles.bookRow,
                idx < books.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
              onPress={() => router.push(`/book/${book.id}`)}
              activeOpacity={0.7}
            >
              {book.photos?.[0]?.url ? (
                <Image source={{ uri: book.photos[0].url }} style={styles.bookThumb} />
              ) : (
                <View style={[styles.bookThumb, styles.bookThumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="book-outline" size={20} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.bookInfo}>
                <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={1}>{book.title}</Text>
                {book.author ? (
                  <Text style={[styles.bookAuthor, { color: colors.textMuted }]} numberOfLines={1}>{book.author}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Menu */}
      <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
              <Ionicons name={item.icon} size={17} color={pastel[item.tint].ink} />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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
    marginBottom: spacing.xl,
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
  booksCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  bookThumb: {
    width: 40,
    height: 56,
    borderRadius: radius.input,
  },
  bookThumbEmpty: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  bookAuthor: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    marginTop: 2,
  },
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
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  menuIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: fontSize.body,
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
