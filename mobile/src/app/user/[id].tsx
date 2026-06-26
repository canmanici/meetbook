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
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Badge, BookCover, Skeleton, palette, pastels, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getUser, listMyBooks, searchNearbyBooks, type UserPublicProfile } from '@/lib/api/client';
import { BOOK_CATEGORY_LABELS } from '@/constants/books';
import { computeCompatibility, extractCategories } from '@/lib/compatibility';
import { Svg, Circle } from 'react-native-svg';

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

      {/* User's books */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitapları</Text>
      </View>

      {userBooks.length === 0 ? (
        <View style={[styles.emptyBooks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="book-outline" size={26} color={colors.primary} />
          </View>
          <Text style={[styles.emptyText, { color: colors.text }]}>Henüz kitap eklenmemiş</Text>
        </View>
      ) : (
        <View style={[styles.booksCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {userBooks.map((book, idx) => (
            <TouchableOpacity
              key={book.id}
              style={[
                styles.bookRow,
                idx < userBooks.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
              onPress={() => router.push(`/book/${book.id}`)}
              activeOpacity={0.7}
            >
              {book.photos?.[0]?.url ? (
                <BookCover url={book.photos[0].url} size={40} />
              ) : (
                <View style={[styles.bookThumb, styles.bookThumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="book-outline" size={20} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.bookInfo}>
                <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={1}>
                  {book.title}
                </Text>
                {book.author ? (
                  <Text style={[styles.bookAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                    {book.author}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
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
  booksCard: {
    marginHorizontal: spacing.lg,
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
});
