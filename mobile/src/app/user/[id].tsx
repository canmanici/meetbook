import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  useColorScheme,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Badge, BookCover, Skeleton, palette, pastels, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getUser, listMyBooks, searchNearbyBooks, type UserPublicProfile } from '@/lib/api/client';
import { BOOK_CATEGORY_LABELS, type BookCategory } from '@/constants/books';
import { computeCompatibility, extractCategories } from '@/lib/compatibility';
import { Svg, Circle } from 'react-native-svg';

const CATEGORY_EMOJI: Record<string, string> = {
  fiction: '📖',
  non_fiction: '🧠',
  textbook: '🎓',
  children: '🧸',
  comics: '💥',
  poetry: '🪶',
  other: '📚',
};

function CompatibilityRing({
  score,
  size = 88,
  strokeWidth = 8,
  color = '#fff',
  trackColor = 'rgba(255,255,255,0.28)',
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', top: 0, left: 0, transform: [{ rotate: '-90deg' }] }}
      >
        <Circle cx={center} cy={center} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Text style={{ color, fontSize: fontSize.title, fontWeight: '900' }}>{score}%</Text>
    </View>
  );
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: profile,
    isLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['user', id],
    queryFn: () => getUser(id),
    enabled: !!id,
  });

  const { data: booksData } = useQuery({
    queryKey: ['user-books', id],
    queryFn: () =>
      searchNearbyBooks({
        owner_id: id,
        limit: 50,
      }),
    enabled: !!id,
  });

  const { data: myBooksData } = useQuery({
    queryKey: ['my-books'],
    queryFn: () => listMyBooks({ limit: 50 }),
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['user', id] }),
        queryClient.invalidateQueries({ queryKey: ['user-books', id] }),
        queryClient.invalidateQueries({ queryKey: ['my-books'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, id]);

  const userBooks = booksData?.items ?? [];
  const myBooks = myBooksData?.items ?? [];

  const compatibility = useMemo(() => {
    if (!userBooks.length || !myBooks.length) return null;
    const result = computeCompatibility(
      extractCategories(myBooks),
      extractCategories(userBooks),
    );
    return result.hasSignal ? result : null;
  }, [myBooks, userBooks]);

  // T50 — Reading identity card derived from this user's books.
  const identity = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const b of userBooks as any[]) {
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
  }, [userBooks]);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.loadingContent}>
          <Skeleton variant="card" />
          <Skeleton variant="list-item" />
        </View>
      </View>
    );
  }

  if (profileError || !profile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.errorContent}>
          <Ionicons name="person-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.errorText, { color: colors.text }]}>Kullanıcı bulunamadı</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={[styles.backLink, { color: colors.primary }]}>Geri dön</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const gradientColors: [string, string] = isDark
    ? ['#1C403A', '#10231F']
    : ['#15917A', '#0C5E50'];

  const identityGradient: [string, string] = isDark
    ? ['#3A2A6B', '#1B1338']
    : ['#6B4EE0', '#3A1F8C'];

  const stats = [
    { value: profile.completed_exchanges, label: 'takas', icon: 'swap-horizontal' as const },
    { value: profile.loans_borrowed_count ?? 0, label: 'ödünç', icon: 'book' as const },
    {
      value: profile.rating_count > 0 ? profile.rating_average.toFixed(1) : '—',
      label: 'puan',
      icon: 'star' as const,
    },
    { value: profile.trust_score ?? 0, label: 'güven', icon: 'shield-checkmark' as const },
  ];

  const shareIdentity = () => {
    if (identity.total === 0) return;
    const lines = identity.entries.map(
      (e) => `${BOOK_CATEGORY_LABELS[e.cat] ?? e.cat}: %${e.pct}`,
    );
    Share.share({
      message: `${profile.name}'in okuma kimliği\n${lines.join('\n')}\nMeetBook`,
    });
  };

  // Chunk user books into rows of 2 for the shelf grid.
  const bookRows: any[][] = [];
  for (let i = 0; i < userBooks.length; i += 2) {
    bookRows.push((userBooks as any[]).slice(i, i + 2));
  }

  return (
    <ScrollView
      testID="user-scroll"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* Header with back button */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(0,0,0,0.3)' }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Hero */}
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}
      >
        <View style={styles.heroAvatar}>
          <Avatar name={profile.name} size="large" verified={false} />
        </View>
        <Text style={styles.heroName}>{profile.name}</Text>
        {profile.rating_count > 0 && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={16} color="#FFD700" />
            <Text style={styles.ratingText}>
              {profile.rating_average.toFixed(1)} ({profile.rating_count} değerlendirme)
            </Text>
          </View>
        )}
        {compatibility && (
          <View style={styles.compatRow}>
            <CompatibilityRing score={compatibility.score} />
            <Text style={styles.compatLabel}>{compatibility.score}% okuma zevki uyumu</Text>
            {compatibility.isTwin && (
              <Badge
                text="Kitap İkizi!"
                variant="primary"
                style={styles.twinBadge}
                testID="book-twin-badge"
              />
            )}
          </View>
        )}
      </LinearGradient>

      {/* Stats */}
      <View style={styles.statsRow}>
        {stats.map((stat) => (
          <View
            key={stat.label}
            style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}
          >
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
                <Text style={styles.identityTitle}>Okuma Kimliği</Text>
                <Text style={styles.identitySub}>
                  {identity.total} kitap · {identity.entries.length} tür
                </Text>
              </View>
            </View>
            {identity.total > 0 && (
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
            )}
          </View>

          {identity.total === 0 ? (
            <Text style={styles.identityEmpty}>
              Bu kullanıcı henüz kitap eklemedi
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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitaplığı</Text>
      </View>

      {userBooks.length === 0 ? (
        <View style={[styles.emptyBooks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="book-outline" size={26} color={colors.primary} />
          </View>
          <Text style={[styles.emptyText, { color: colors.text }]}>Henüz kitap eklenmemiş</Text>
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
  errorContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  backLink: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
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
  heroName: {
    fontSize: fontSize.heading,
    fontWeight: '900',
    color: '#fff',
    marginTop: spacing.md,
    letterSpacing: -0.3,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  ratingText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  compatRow: {
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  compatLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
  },
  twinBadge: {
    backgroundColor: '#fff',
    alignSelf: 'center',
    marginTop: spacing.xs,
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
});
