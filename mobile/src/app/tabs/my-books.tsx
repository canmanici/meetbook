import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { listMyBooks, deleteBook, updateBook, authedRequest, type BookOwnerView } from '@/lib/api/client';
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

type IconName = ComponentProps<typeof Ionicons>['name'];
type BadgeColor = 'success' | 'info' | 'warning' | 'danger';

const VACATION_KEY = 'vacation_mode';

/** F07 — Photo quality score (0-5): photo coverage + description + ISBN. */
function photoCount(book: BookOwnerView): number {
  return book.photos?.length ?? 0;
}

function photoQualityScore(book: BookOwnerView): number {
  const n = photoCount(book);
  const photoPts = n >= 3 ? 3 : n === 2 ? 2 : n === 1 ? 1 : 0;
  const descPts = book.description && book.description.trim().length > 0 ? 1 : 0;
  const isbnPts = book.isbn && book.isbn.trim().length > 0 ? 1 : 0;
  return photoPts + descPts + isbnPts;
}

function qualityTier(score: number): { label: string; color: BadgeColor } {
  if (score >= 5) return { label: 'Mükemmel', color: 'success' };
  if (score >= 3) return { label: 'İyi', color: 'info' };
  if (score >= 1) return { label: 'Geliştirilebilir', color: 'warning' };
  return { label: 'Eksik', color: 'danger' };
}

/** F14 — Listing health score (0-4): photo quality + rich description + category + availability. */
function listingHealthScore(book: BookOwnerView): number {
  let s = 0;
  if (photoQualityScore(book) >= 3) s += 1;
  if (book.description && book.description.trim().length > 50) s += 1;
  if ((book.category as string) !== 'other') s += 1;
  if (book.is_available) s += 1;
  return s;
}

function healthTier(score: number): { label: string; color: BadgeColor } {
  if (score >= 4) return { label: 'Sağlıklı', color: 'success' };
  if (score >= 2) return { label: 'Orta', color: 'warning' };
  return { label: 'Zayıf', color: 'danger' };
}

// ---------------------------------------------------------------------------
// B19 — Smart relisting
// ---------------------------------------------------------------------------

export type StaleBook = {
  id: string;
  title: string;
  author?: string | null;
  isbn?: string | null;
  description?: string | null;
  category: string;
  language: string;
  condition: string;
  is_available: boolean;
  photos?: Array<{ id: string; url: string; thumbnail_url?: string; position: number }>;
  view_count: number;
  favorite_count: number;
  days_since_update: number;
  last_activity: string;
  updated_at: string;
  created_at: string;
};

export type StaleBooksResponse = {
  items: StaleBook[];
  days_threshold: number;
};

async function listStaleBooks(days = 30): Promise<StaleBooksResponse> {
  return authedRequest<StaleBooksResponse>('/books/stale', 'GET', undefined, {
    query: { days },
  });
}

async function relistBookApi(bookId: string): Promise<BookOwnerView> {
  return authedRequest<BookOwnerView>(`/books/${bookId}/relist`, 'POST', undefined);
}

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
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [vacationMode, setVacationMode] = useState(false);

  const bulk = useBulkSelect();

  const [actionSheetBook, setActionSheetBook] = useState<BookOwnerView | null>(null);
  const [qrBook, setQrBook] = useState<BookOwnerView | null>(null);

  const [staleExpanded, setStaleExpanded] = useState(false);
  const [relistToast, setRelistToast] = useState<string | null>(null);

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
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
  });

  const staleQuery = useQuery({
    queryKey: ['books', 'stale'],
    queryFn: () => listStaleBooks(30),
    staleTime: 60 * 1000,
  });
  const staleBooks = staleQuery.data?.items ?? [];

  const allBooks = useMemo(
    () => (data?.pages.flatMap((p) => p?.items ?? []) ?? []) as BookOwnerView[],
    [data],
  );

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

  const stats = useMemo(() => {
    const totalViews = allBooks.reduce((sum, b) => sum + (b.view_count || 0), 0);
    const mostViewed = allBooks.reduce(
      (top, b) => (b.view_count > (top?.view_count ?? -1) ? b : top),
      null as BookOwnerView | null,
    );
    const availableCount = allBooks.filter((b) => b.is_available).length;
    return { totalViews, mostViewed, availableCount, totalCount: allBooks.length };
  }, [allBooks]);

  useEffect(() => {
    AsyncStorage.getItem(VACATION_KEY)
      .then((v) => setVacationMode(v === 'true'))
      .catch(() => undefined);
  }, []);

  const toggleVacation = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setVacationMode((prev) => {
      const next = !prev;
      AsyncStorage.setItem(VACATION_KEY, next ? 'true' : 'false').catch(() => undefined);
      return next;
    });
  }, []);

  /** F15 — Performance insight computed from the owner's own book data. */
  const insight = useMemo(() => {
    if (allBooks.length === 0) return null;
    const avg = (arr: BookOwnerView[]) =>
      arr.length ? arr.reduce((s, b) => s + (b.view_count || 0), 0) / arr.length : 0;
    const high = allBooks.filter((b) => photoCount(b) >= 3);
    const low = allBooks.filter((b) => photoCount(b) <= 1);
    const avgHigh = avg(high);
    const avgLow = avg(low);
    const ratio = avgLow > 0 ? avgHigh / avgLow : 0;
    const allHave3 = allBooks.every((b) => photoCount(b) >= 3);
    const tips: { icon: IconName; text: string; tone: 'good' | 'tip' }[] = [];
    if (allHave3) {
      tips.push({ icon: 'checkmark-circle', text: 'Harika! Tüm kitaplarında 3 fotoğraf var', tone: 'good' });
    } else {
      const ratioLabel = ratio >= 2 ? `${Math.round(ratio)}x` : '5x';
      tips.push({ icon: 'camera', text: `3+ fotoğraf ${ratioLabel} daha fazla talep getiriyor`, tone: 'tip' });
    }
    const missingDesc = allBooks.some((b) => !b.description || b.description.trim().length === 0);
    if (missingDesc) {
      tips.push({ icon: 'document-text', text: 'Açıklama ekleyin, 3x daha fazla görüntülenme', tone: 'tip' });
    } else {
      tips.push({ icon: 'checkmark-circle', text: 'Tüm kitaplarında açıklama var', tone: 'good' });
    }
    return { tips, avgHigh, avgLow, ratio };
  }, [allBooks]);

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

  const relistMutation = useMutation({
    mutationFn: (bookId: string) => relistBookApi(bookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books', 'stale'] });
      queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
    },
  });

  useEffect(() => {
    if (!relistToast) return;
    const t = setTimeout(() => setRelistToast(null), 2500);
    return () => clearTimeout(t);
  }, [relistToast]);

  const handleRelist = useCallback(
    (book: StaleBook) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setRelistToast(`"${book.title}" yeniden listelendi`);
      relistMutation.mutate(book.id);
    },
    [relistMutation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), staleQuery.refetch()]);
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
            <TouchableOpacity
              onPress={toggleVacation}
              style={[styles.vacationToggle, { backgroundColor: vacationMode ? colors.warning + '22' : colors.surface, borderColor: vacationMode ? colors.warning + '40' : colors.border }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: vacationMode }}
              accessibilityLabel="Tatil modu"
            >
              <Ionicons name="airplane" size={14} color={vacationMode ? colors.warning : colors.textMuted} />
              <Text style={[styles.vacationToggleText, { color: vacationMode ? colors.warning : colors.textMuted }]}>
                Tatil
              </Text>
            </TouchableOpacity>
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
        {!bulk.isSelectMode && !isLoading && !isError && allBooks.length > 0 ? (
          <>
            {staleBooks.length > 0 ? (
              <View
                style={[
                  styles.staleCard,
                  { backgroundColor: colors.warning + '1A', borderColor: colors.warning + '40' },
                ]}
              >
                <View style={styles.staleHeader}>
                  <View style={styles.staleTitleWrap}>
                    <Ionicons name="time-outline" size={16} color={colors.warning} />
                    <Text style={[styles.staleTitle, { color: colors.text }]}>
                      Yeniden Listeleme Önerisi
                    </Text>
                  </View>
                  <View style={[styles.staleCountBadge, { backgroundColor: colors.warning + '26' }]}>
                    <Text style={[styles.staleCountText, { color: colors.warning }]}>
                      {staleBooks.length}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.staleSubtitle, { color: colors.textMuted }]}>
                  {staleBooks.length} kitabın 30 gündür aktif değil
                </Text>

                <TouchableOpacity
                  style={[styles.staleToggle, { borderColor: colors.warning + '55' }]}
                  onPress={() => setStaleExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Yeniden listeleme önerilerini göster"
                >
                  <Text style={[styles.staleToggleText, { color: colors.warning }]}>
                    {staleExpanded ? 'Gizle' : 'Göster'}
                  </Text>
                  <Ionicons
                    name={staleExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.warning}
                  />
                </TouchableOpacity>

                {staleExpanded ? (
                  <View style={[styles.staleList, { borderTopColor: colors.warning + '30' }]}>
                    {staleBooks.map((book) => (
                      <View
                        key={book.id}
                        style={[styles.staleRow, { borderBottomColor: colors.border }]}
                      >
                        <View style={styles.staleRowInfo}>
                          <Text style={[styles.staleBookTitle, { color: colors.text }]} numberOfLines={1}>
                            {book.title}
                          </Text>
                          <View style={styles.staleMetaRow}>
                            <View style={styles.staleMetaItem}>
                              <Ionicons name="time" size={11} color={colors.textMuted} />
                              <Text style={[styles.staleMetaText, { color: colors.textMuted }]}>
                                {book.days_since_update} gün aktif değil
                              </Text>
                            </View>
                            <View style={styles.staleMetaItem}>
                              <Ionicons name="eye-outline" size={11} color={colors.textMuted} />
                              <Text style={[styles.staleMetaText, { color: colors.textMuted }]}>
                                {book.view_count} görüntülenme
                              </Text>
                            </View>
                          </View>
                        </View>
                        <View style={styles.staleRowActions}>
                          <TouchableOpacity
                            style={[styles.relistBtn, { backgroundColor: colors.warning }]}
                            onPress={() => handleRelist(book)}
                            disabled={relistMutation.isPending}
                            accessibilityRole="button"
                            accessibilityLabel={`Yeniden listele: ${book.title}`}
                          >
                            <Ionicons name="refresh" size={12} color="#fff" />
                            <Text style={styles.relistBtnText}>Yeniden Listele</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.editBtn, { borderColor: colors.border }]}
                            onPress={() => router.push(`/book/${book.id}?edit=1`)}
                            accessibilityRole="button"
                            accessibilityLabel={`Düzenle: ${book.title}`}
                          >
                            <Ionicons name="create-outline" size={12} color={colors.text} />
                            <Text style={[styles.editBtnText, { color: colors.text }]}>Düzenle</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            {vacationMode ? (
              <View style={[styles.vacationBanner, { backgroundColor: colors.warning + '1A', borderColor: colors.warning + '40' }]}>
                <Ionicons name="airplane" size={18} color={colors.warning} />
                <Text style={[styles.vacationText, { color: colors.text }]}>
                  Tatil modu aktif — kitapların görünmüyor
                </Text>
              </View>
            ) : null}
            {insight ? (
              <View style={[styles.insightCard, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                <View style={styles.insightHeader}>
                  <Ionicons name="bulb" size={16} color={colors.primary} />
                  <Text style={[styles.insightTitle, { color: colors.text }]}>İçgörü</Text>
                </View>
                {insight.tips.map((tip, i) => (
                  <View key={i} style={styles.insightRow}>
                    <Ionicons name={tip.icon} size={14} color={tip.tone === 'good' ? colors.success : colors.warning} />
                    <Text style={[styles.insightText, { color: colors.text }]}>{tip.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {!bulk.isSelectMode && !isLoading && !isError && allBooks.length > 0 ? (
          <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.statsHeader}
              onPress={() => setStatsExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="İstatistikleri aç/kapat"
            >
              <View style={styles.statsTitleWrap}>
                <Ionicons name="stats-chart" size={16} color={colors.primary} />
                <Text style={[styles.statsTitle, { color: colors.text }]}>İstatistikler</Text>
              </View>
              <Ionicons
                name={statsExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {statsExpanded ? (
              <View style={[styles.statsBody, { borderTopColor: colors.border }]}>
                <Text style={[styles.statsRow, { color: colors.text }]}>
                  Toplam Görüntülenme: {stats.totalViews}
                </Text>
                <Text style={[styles.statsRow, { color: colors.text }]} numberOfLines={1}>
                  En Popüler:{' '}
                  {stats.mostViewed ? `"${stats.mostViewed.title}" (${stats.mostViewed.view_count})` : '—'}
                </Text>
                <Text style={[styles.statsRow, { color: colors.text }]}>
                  Müsait: {stats.availableCount} / {stats.totalCount} kitap
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
            filteredBooks.map((book, index) => {
              const pq = photoQualityScore(book);
              const qTier = qualityTier(pq);
              const hh = listingHealthScore(book);
              const hTier = healthTier(hh);
              return (
              <Animated.View
                key={book.id}
                entering={FadeInDown.delay(index * 80).duration(300)}
              >
                <View style={styles.badgeRow}>
                  <View style={[styles.qBadge, { backgroundColor: colors[qTier.color] + '1A' }]}>
                    <Ionicons name="camera" size={10} color={colors[qTier.color]} />
                    <Text style={[styles.qBadgeText, { color: colors[qTier.color] }]}>
                      {qTier.label} · {pq}/5
                    </Text>
                  </View>
                  <View style={[styles.qBadge, { backgroundColor: colors[hTier.color] + '1A' }]}>
                    <Ionicons name="pulse" size={10} color={colors[hTier.color]} />
                    <Text style={[styles.qBadgeText, { color: colors[hTier.color] }]}>
                      {hTier.label}
                    </Text>
                  </View>
                </View>
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
              );
            })
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
                    <View style={[styles.gridDot, { backgroundColor: colors[qualityTier(photoQualityScore(book)).color] }]} />
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

      {relistToast ? (
        <View style={[styles.toast, { backgroundColor: colors.warning }]}>
          <View style={styles.toastContent}>
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.relistToastMsg} numberOfLines={1}>
              {relistToast}
            </Text>
          </View>
        </View>
      ) : null}
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
  statsCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  statsTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statsTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  statsBody: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    borderTopWidth: 1,
  },
  statsRow: {
    fontSize: fontSize.caption,
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
  vacationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
  },
  vacationToggleText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  vacationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  vacationText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    flex: 1,
  },
  insightCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insightTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  insightText: {
    fontSize: fontSize.caption,
    flex: 1,
    lineHeight: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: 6,
    marginLeft: 2,
    flexWrap: 'wrap',
  },
  qBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  qBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  gridDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  // B19 — Smart relisting
  staleCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  staleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  staleTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  staleTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  staleCountBadge: {
    minWidth: 22,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  staleCountText: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  staleSubtitle: {
    fontSize: fontSize.caption,
  },
  staleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  staleToggleText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  staleList: {
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    gap: 0,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  staleRowInfo: {
    flex: 1,
    gap: 3,
  },
  staleBookTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  staleMetaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  staleMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  staleMetaText: {
    fontSize: 11,
  },
  staleRowActions: {
    gap: spacing.xs,
    alignItems: 'flex-end',
  },
  relistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  relistBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  relistToastMsg: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    flex: 1,
    marginLeft: spacing.sm,
  },
});
