import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { listMyBooks, deleteBook, updateBook, type BookOwnerView } from '@/lib/api/client';
import { CollapsingHeader } from '@/components/my-books/CollapsingHeader';
import { MyBookCard } from '@/components/my-books/MyBookCard';
import { MyBookGridTile } from '@/components/my-books/MyBookGridTile';
import { BookActionSheet } from '@/components/my-books/BookActionSheet';
import { BookQRModal } from '@/components/my-books/BookQRModal';
import { SortMenu, type SortMode } from '@/components/my-books/SortMenu';
import { BulkSelectHeader, BulkSelectFab, useBulkSelect } from '@/components/my-books/BulkSelectManager';
import { useUndoDelete } from '@/hooks/use-undo-delete';

type ViewMode = 'list' | 'grid';
type TabKey = 'active' | 'completed';

export default function MyBooksTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [refreshing, setRefreshing] = useState(false);

  const bulk = useBulkSelect();

  const [actionSheetBook, setActionSheetBook] = useState<BookOwnerView | null>(null);
  const [qrBook, setQrBook] = useState<BookOwnerView | null>(null);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['books', 'me'],
    queryFn: ({ pageParam }) => listMyBooks({ cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const allBooks = useMemo(() => (data?.pages.flatMap((p) => p.items) ?? []) as BookOwnerView[], [data]);

  const filteredBooks = useMemo(() => {
    let books = allBooks;
    books = books.filter((b) => activeTab === 'active' ? b.is_available : !b.is_available);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      books = books.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.author ?? '').toLowerCase().includes(q) ||
          (b.isbn ?? '').toLowerCase().includes(q),
      );
    }
    const sorted = [...books];
    switch (sortMode) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'author':
        sorted.sort((a, b) => (a.author ?? '').localeCompare(b.author ?? ''));
        break;
      case 'views':
        sorted.sort((a, b) => b.view_count - a.view_count);
        break;
    }
    return sorted;
  }, [allBooks, activeTab, searchQuery, sortMode]);

  const activeBooks = useMemo(() => allBooks.filter((b) => b.is_available), [allBooks]);
  const completedBooks = useMemo(() => allBooks.filter((b) => !b.is_available), [allBooks]);

  const undoDelete = useUndoDelete<BookOwnerView>();
  undoDelete.setCallbacks(
    async (book) => {
      await deleteBook(book.id);
      queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
    },
    (book) => {
      queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
    },
  );

  const toggleMutation = useMutation({
    mutationFn: (book: BookOwnerView) =>
      updateBook(book.id, { is_available: !book.is_available }),
    onMutate: async (book) => {
      await queryClient.cancelQueries({ queryKey: ['books', 'me'] });
      const prev = queryClient.getQueryData(['books', 'me']);
      updateBookInCache(queryClient, book.id, { is_available: !book.is_available });
      return { prev };
    },
    onError: (_err, _book, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['books', 'me'], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteBook(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['books', 'me'] }),
  });

  const bulkToggleMutation = useMutation({
    mutationFn: async ({ ids, setAvailable }: { ids: string[]; setAvailable: boolean }) => {
      const results = await Promise.allSettled(
        ids.map((id) => updateBook(id, { is_available: setAvailable })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['books', 'me'] }),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLongPress = useCallback(
    (book: BookOwnerView) => {
      if (bulk.isSelectMode) {
        bulk.toggle(book.id);
      } else {
        setActionSheetBook(book);
      }
    },
    [bulk],
  );

  const handleActionSheetAction = useCallback(
    (key: string) => {
      if (!actionSheetBook) return;
      const book = actionSheetBook;
      setActionSheetBook(null);

      switch (key) {
        case 'toggle':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          toggleMutation.mutate(book);
          break;
        case 'edit':
          router.push(`/book/${book.id}?edit=1`);
          break;
        case 'share':
          Sharing.shareAsync(`https://meetbook.app/book/${book.id}`, {
            dialogTitle: `${book.title} — Meetbook`,
          }).catch(() => {});
          break;
        case 'qr':
          setQrBook(book);
          break;
        case 'delete':
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          undoDelete.deleteItem(book);
          break;
      }
    },
    [actionSheetBook, toggleMutation, undoDelete],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {bulk.isSelectMode ? (
        <BulkSelectHeader
          count={bulk.count}
          onClose={bulk.exit}
          onSelectAll={() => bulk.selectAll(filteredBooks.map((b) => b.id))}
        />
      ) : null}

      {!bulk.isSelectMode && (
        <>
          <CollapsingHeader
            activeCount={activeBooks.length}
            completedCount={completedBooks.length}
            totalCount={allBooks.length}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          <View style={[styles.toolbar, { paddingHorizontal: spacing.lg }]}>
            <View style={[styles.searchWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="search" size={14} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Kitap, yazar veya ISBN ara"
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                accessibilityLabel="Ara"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <SortMenu current={sortMode} onChange={setSortMode} />
            <TouchableOpacity
              onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              style={[styles.viewToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityLabel={viewMode === 'list' ? 'Grid görünüm' : 'Liste görünüm'}
            >
              <Ionicons
                name={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
                size={16}
                color={colors.primary}
              />
            </TouchableOpacity>
          </View>
        </>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          if (contentOffset.y + layoutMeasurement.height > contentSize.height - 200) {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }
        }}
        scrollEventThrottle={200}
      >
        {searchQuery.trim() && filteredBooks.length === 0 ? (
          <EmptyState
            message="Arama için sonuç yok"
            description="Farklı bir kelime deneyin"
            icon="search-outline"
          />
        ) : isLoading ? (
          viewMode === 'list' ? (
            <>
              <Skeleton variant="card" />
              <Skeleton variant="card" />
              <Skeleton variant="card" />
            </>
          ) : (
            <View style={styles.gridRow}>
              {[1, 2, 3, 4].map((i) => (
                <View key={i} style={[styles.gridSkeleton, { backgroundColor: colors.surfaceAlt }]} />
              ))}
            </View>
          )
        ) : isError ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '30' }]}>
            <Ionicons name="cloud-offline-outline" size={24} color={colors.danger} />
            <EmptyState
              message="Kitaplar yüklenemedi"
              description="İnternet bağlantınızı kontrol edin"
              icon="cloud-offline-outline"
              actionLabel="Tekrar dene"
              onAction={() => refetch()}
            />
          </View>
        ) : filteredBooks.length === 0 ? (
          activeTab === 'active' ? (
            <EmptyState
              message="Henüz kitap eklenmedi"
              description="Kitap ekleyerek takasa başlayın"
              icon="book-outline"
              actionLabel="+ Kitap ekle"
              onAction={() => router.push('/book/new')}
            />
          ) : (
            <EmptyState
              message="Henüz takas edilen kitap yok"
              description="Tamamlanan takaslar burada görünecek"
              icon="swap-horizontal-outline"
            />
          )
        ) : (
          viewMode === 'list' ? (
            filteredBooks.map((book, index) => (
              <Animated.View
                key={book.id}
                entering={FadeInDown.delay(index * 80).duration(300)}
              >
                <MyBookCard
                  id={book.id}
                  title={book.title}
                  author={book.author}
                  coverUrl={book.photos?.[0]?.url}
                  category={book.category as string}
                  condition={book.condition as string}
                  language={book.language}
                  description={book.description}
                  viewCount={book.view_count}
                  favoriteCount={book.favorite_count}
                  createdAt={book.created_at}
                  isAvailable={book.is_available}
                  onPress={() => router.push(`/book/${book.id}`)}
                  onLongPress={() => handleLongPress(book)}
                />
              </Animated.View>
            ))
          ) : (
            <View style={styles.gridRow}>
              {filteredBooks.length === 0 ? null : (
                filteredBooks.map((book, index) => (
                  <Animated.View
                    key={book.id}
                    entering={FadeInDown.delay(index * 80).duration(300)}
                    style={styles.gridItem}
                  >
                    <MyBookGridTile
                      id={book.id}
                      title={book.title}
                      author={book.author}
                      coverUrl={book.photos?.[0]?.url}
                      condition={book.condition as string}
                      onPress={() => router.push(`/book/${book.id}`)}
                      onLongPress={() => handleLongPress(book)}
                    />
                  </Animated.View>
                ))
              )}
            </View>
          )
        )}

        {isFetchingNextPage && (
          viewMode === 'list' ? (
            <Skeleton variant="card" />
          ) : (
            <View style={styles.gridRow}>
              <Skeleton variant="card" />
              <Skeleton variant="card" />
            </View>
          )
        )}
      </ScrollView>

      {bulk.isSelectMode ? (
        <BulkSelectFab
          count={bulk.count}
          onDelete={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            bulkDeleteMutation.mutate(Array.from(bulk.selectedIds));
            bulk.exit();
          }}
          onToggleAvailability={(setAvailable) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            bulkToggleMutation.mutate({ ids: Array.from(bulk.selectedIds), setAvailable });
            bulk.exit();
          }}
        />
      ) : (
        <TouchableOpacity
          style={[styles.fab, { shadowColor: colors.primary }]}
          onPress={() => router.push('/book/new')}
          activeOpacity={0.85}
          accessibilityLabel="Yeni kitap ekle"
        >
          <LinearGradient
            colors={[colors.primary, colors.primary + 'CC']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabGradient}
          >
            <Ionicons name="add" size={28} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      )}

      <BookActionSheet
        visible={!!actionSheetBook}
        onClose={() => setActionSheetBook(null)}
        onAction={handleActionSheetAction}
        bookTitle={actionSheetBook?.title ?? ''}
        isAvailable={actionSheetBook?.is_available ?? true}
      />

      <BookQRModal
        visible={!!qrBook}
        onClose={() => setQrBook(null)}
        bookId={qrBook?.id ?? ''}
        title={qrBook?.title ?? ''}
        author={qrBook?.author ?? null}
        coverUrl={qrBook?.photos?.[0]?.url}
      />

      {undoDelete.toast && (
        <View style={[styles.toast, { backgroundColor: '#2A2722' }]}>
          <View style={styles.toastContent}>
            <Text style={styles.toastMsg} numberOfLines={1}>
              {undoDelete.toast.message}
            </Text>
            <TouchableOpacity
              onPress={() => undoDelete.undoAll()}
              style={styles.undoBtn}
              accessibilityLabel="Geri al"
            >
              <Text style={styles.undoText}>Geri Al</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.progressBar, { width: `${undoDelete.toast.progress}%` }]} />
        </View>
      )}
    </View>
  );
}

function updateBookInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  bookId: string,
  partial: Partial<Pick<BookOwnerView, 'is_available'>>,
) {
  queryClient.setQueryData(['books', 'me'], (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        items: page.items.map((item: BookOwnerView) =>
          item.id === bookId ? { ...item, ...partial } : item,
        ),
      })),
    };
  });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: '500',
    padding: 0,
  },
  viewToggle: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingVertical: spacing.sm,
    paddingBottom: 120,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    width: '48%',
  },
  gridSkeleton: {
    width: '48%',
    aspectRatio: 0.65,
    borderRadius: 22,
    marginBottom: 12,
  },
  errorBanner: {
    borderRadius: 22,
    padding: spacing.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 5,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toast: {
    position: 'absolute',
    bottom: 100,
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastMsg: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    flex: 1,
  },
  undoBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: 'rgba(79,194,171,0.18)',
    marginLeft: spacing.sm,
  },
  undoText: {
    color: '#4FC2AB',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#4FC2AB',
  },
});
