import { useQueryClient, useQueries } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { EmptyState, Skeleton, palette, spacing, radius, fontSize, shadows } from '@/components/ui';
import { getBook, removeFavorite as removeFavoriteApi, type BookView } from '@/lib/api/client';
import { useFavoritesStore, type FavoriteItem } from '@/stores/favorites';
import { useToast } from '@/hooks/use-toast';
import { BOOK_CONDITION_LABELS, type BookCondition } from '@/constants/books';

// Backend BookCondition values are "new" | "like_new" | "good" | "worn".
// Map each to a palette key for the condition badge tint.
const conditionColorKeys: Record<BookCondition, 'success' | 'primary' | 'warning'> = {
  new: 'success',
  like_new: 'success',
  good: 'primary',
  worn: 'warning',
};

export default function FavoritesScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const favoritesStore = useFavoritesStore();
  const [refreshing, setRefreshing] = useState(false);

  // Local favorites store is the source of truth for *which* books are
  // favorited (search results don't carry is_favorited). Sort newest first.
  const items = useMemo(
    () =>
      Object.values(favoritesStore.favorites).sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
      ),
    [favoritesStore.favorites],
  );

  // Enrich each favorite with live book details (author, condition, cover,
  // availability) via GET /books/{id}. BookOwnerView/BookPublicView carry
  // is_favorited + favorite_count; search results do not.
  const bookQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['book', item.bookId] as const,
      queryFn: () => getBook(item.bookId),
      retry: false,
      staleTime: 60_000,
    })),
  });

  const hasAnyResolved = bookQueries.some((q) => q.isSuccess || q.isError);
  const initialLoading = items.length > 0 && !hasAnyResolved;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(bookQueries.map((q) => q.refetch()));
    } finally {
      setRefreshing(false);
    }
  }, [bookQueries]);

  const handleRemove = useCallback(
    async (item: FavoriteItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Optimistic: drop from local store so the card disappears immediately.
      favoritesStore.removeFavorite(item.bookId);
      try {
        await removeFavoriteApi(item.bookId);
        toast.show('Favorilerden çıkarıldı', { variant: 'info' });
        queryClient.invalidateQueries({ queryKey: ['book', item.bookId] });
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        if (status === 404) {
          // Book was deleted server-side — keep it removed locally, stay quiet.
          return;
        }
        // Revert optimistic update on failure.
        favoritesStore.addFavorite(item);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show('Favori kaldırılamadı', { variant: 'error' });
      }
    },
    [favoritesStore, toast, queryClient],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FavoriteItem; index: number }) => {
      const q = bookQueries[index];
      const book = q?.data as BookView | undefined;
      const notFound = !!q?.isError && (q?.error as any)?.status === 404;

      const coverUrl =
        book?.photos?.[0]?.thumbnail_url || book?.photos?.[0]?.url || item.coverUrl;
      const author = book?.author;
      const condition = book?.condition;
      const conditionColorKey = condition ? conditionColorKeys[condition] : null;
      const conditionColor = conditionColorKey ? colors[conditionColorKey] : null;

      return (
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface }]}
          onPress={() => router.push(`/book/${item.bookId}`)}
          activeOpacity={0.7}
          testID={`favorite-card-${item.bookId}`}
          accessibilityRole="button"
          accessibilityLabel={`Kitabı görüntüle: ${item.title}`}
        >
          <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]}>
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={styles.coverImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            ) : (
              <Ionicons name="book-outline" size={24} color={colors.textMuted} />
            )}
          </View>

          <View style={styles.cardContent}>
            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            {notFound ? (
              <Text style={[styles.cardAuthor, { color: colors.danger }]} numberOfLines={1}>
                Kitap artık mevcut değil
              </Text>
            ) : author ? (
              <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                {author}
              </Text>
            ) : (
              <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                Yükleniyor…
              </Text>
            )}

            <View style={styles.metaRow}>
              {condition && conditionColor ? (
                <View style={[styles.badge, { backgroundColor: conditionColor + '20' }]}>
                  <View style={[styles.dot, { backgroundColor: conditionColor }]} />
                  <Text style={[styles.badgeText, { color: conditionColor }]}>
                    {BOOK_CONDITION_LABELS[condition] ?? condition}
                  </Text>
                </View>
              ) : null}
              {book && !notFound ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        (book.is_available ? colors.success : colors.warning) + '20',
                    },
                  ]}
                >
                  <Ionicons
                    name={book.is_available ? 'checkmark-circle' : 'time-outline'}
                    size={12}
                    color={book.is_available ? colors.success : colors.warning}
                  />
                  <Text
                    style={[
                      styles.badgeText,
                      { color: book.is_available ? colors.success : colors.warning },
                    ]}
                  >
                    {book.is_available ? 'Mevcut' : 'Takasta'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: colors.accent + '15' }]}
            onPress={() => handleRemove(item)}
            activeOpacity={0.6}
            testID={`favorite-remove-${item.bookId}`}
            accessibilityRole="button"
            accessibilityLabel="Favorilerden çıkar"
          >
            <Ionicons name="heart" size={18} color={colors.accent} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [bookQueries, colors, handleRemove],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Favorilerim</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      {items.length === 0 ? (
        <EmptyState
          message="Henüz favori kitabın yok"
          description="Beğendiğin kitapların kalbine dokunarak buraya ekleyebilirsin"
          icon="heart-outline"
          actionLabel="Kitapları Keşfet"
          onAction={() => router.push('/tabs/home')}
        />
      ) : initialLoading ? (
        <View style={styles.skeletonWrap}>
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.bookId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        />
      )}
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
  backButton: { padding: spacing.xs },
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
  skeletonWrap: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  cover: {
    width: 48,
    height: 64,
    borderRadius: radius.input,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardAuthor: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
});
