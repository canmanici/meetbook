import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, Skeleton, palette, spacing, fontSize, radius, BookCard } from '@/components/ui';
import { listMyBooks, deleteBook, type BookOwnerView } from '@/lib/api/client';

type BookTab = 'active' | 'completed';

export default function MyBooksTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<BookTab>('active');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['books', 'me'],
    queryFn: () => listMyBooks(),
  });

  const allBooks = data?.items ?? [];
  const activeBooks = allBooks.filter((b) => b.is_available);
  const completedBooks = allBooks.filter((b) => !b.is_available);
  const books = activeTab === 'active' ? activeBooks : completedBooks;

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const tabs: { key: BookTab; label: string; icon: keyof typeof Ionicons.glyphMap; count: number }[] = [
    { key: 'active', label: 'Aktif', icon: 'checkmark-circle', count: activeBooks.length },
    { key: 'completed', label: 'Takas Edilen', icon: 'swap-horizontal', count: completedBooks.length },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Segmented Tabs */}
      <View style={styles.tabContainer}>
        <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt }]}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, isActive && styles.tabActive]}
                testID={`my-books-tab-${tab.key}`}
              >
                {isActive && (
                  <LinearGradient
                    colors={[colors.primary, colors.primary + 'DD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.tabGradient}
                  />
                )}
                <Ionicons
                  name={tab.icon}
                  size={15}
                  color={isActive ? '#fff' : colors.textMuted}
                  style={{ marginRight: 5 }}
                />
                <Text style={[styles.tabText, { color: isActive ? '#fff' : colors.textMuted }]}>
                  {tab.label}
                </Text>
                {isActive && (
                  <View style={[styles.tabBadge, { backgroundColor: '#fff' }]}>
                    <Text style={[styles.tabBadgeText, { color: colors.primary }]}>{tab.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard
          label="Toplam"
          value={allBooks.length}
          icon="library"
          colors={colors}
          gradient={[colors.primary, colors.primary + 'BB']}
        />
        <StatCard
          label="Aktif"
          value={activeBooks.length}
          icon="checkmark-circle"
          colors={colors}
          gradient={[colors.success, colors.success + 'BB']}
        />
        <StatCard
          label="Takas"
          value={completedBooks.length}
          icon="swap-horizontal"
          colors={colors}
          gradient={[colors.warning, colors.warning + 'BB']}
        />
      </View>

      {/* Book List */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {isLoading ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : books.length === 0 ? (
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
          books.map((book) => (
            <MyBookCard
              key={book.id}
              book={book}
              colors={colors}
              queryClient={queryClient}
            />
          ))
        )}
      </ScrollView>

      {/* Floating Add Button */}
      <TouchableOpacity
        style={[styles.fab, { shadowColor: colors.primary }]}
        onPress={() => router.push('/book/new')}
        activeOpacity={0.85}
        testID="add-book-fab"
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
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  colors,
  gradient,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  colors: typeof palette.light;
  gradient: string[];
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statIconWrap}
      >
        <Ionicons name={icon} size={18} color="#fff" />
      </LinearGradient>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function MyBookCard({
  book,
  colors,
  queryClient,
}: {
  book: BookOwnerView;
  colors: typeof palette.light;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const deleteMutation = useMutation({
    mutationFn: () => deleteBook(book.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
    },
    onError: () => {
      Alert.alert('Hata', 'Kitap silinemedi.');
    },
  });

  const handleDelete = () => {
    Alert.alert(
      'Kitabı Sil',
      `"${book.title}" silinecek. Emin misiniz?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(),
        },
      ]
    );
  };

  return (
    <View style={[styles.myBookCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => router.push(`/book/${book.id}`)}
        activeOpacity={0.7}
        style={styles.myBookCardInner}
      >
        {/* Cover */}
        <View style={styles.myBookCoverWrap}>
          {book.photos?.[0]?.url ? (
            <Image source={{ uri: book.photos[0].url }} style={styles.myBookCover} resizeMode="cover" />
          ) : (
            <View style={[styles.myBookCover, styles.myBookCoverFallback, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="book-outline" size={28} color={colors.textMuted} />
            </View>
          )}
          {/* Status dot */}
          <View style={[styles.statusDot, { backgroundColor: book.is_available ? colors.success : colors.textMuted }]} />
        </View>

        {/* Info */}
        <View style={styles.myBookInfo}>
          <Text style={[styles.myBookTitle, { color: colors.text }]} numberOfLines={1}>{book.title}</Text>
          <Text style={[styles.myBookAuthor, { color: colors.textMuted }]} numberOfLines={1}>{book.author ?? 'Bilinmeyen yazar'}</Text>

          <View style={styles.myBookMeta}>
            <View style={[styles.metaPill, { backgroundColor: colors.primary + '15' }]}>
              <View style={[styles.metaDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.metaPillText, { color: colors.primary }]}>
                {book.condition === 'new' ? 'Yeni' : book.condition === 'like-new' ? 'Yeni gibi' : book.condition === 'good' ? 'İyi' : book.condition === 'fair' ? 'İdare eder' : 'Kötü'}
              </Text>
            </View>
            {book.category && (
              <View style={[styles.metaPill, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.metaPillText, { color: colors.textMuted }]} numberOfLines={1}>{book.category}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={[styles.myBookActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={styles.myBookActionBtn}
          onPress={() => router.push(`/book/${book.id}`)}
          activeOpacity={0.6}
        >
          <Ionicons name="eye-outline" size={18} color={colors.primary} />
          <Text style={[styles.myBookActionText, { color: colors.primary }]}>Görüntüle</Text>
        </TouchableOpacity>
        <View style={[styles.myBookActionDivider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          style={styles.myBookActionBtn}
          onPress={() => router.push(`/book/${book.id}`)}
          activeOpacity={0.6}
        >
          <Ionicons name="create-outline" size={18} color={colors.info} />
          <Text style={[styles.myBookActionText, { color: colors.info }]}>Düzenle</Text>
        </TouchableOpacity>
        <View style={[styles.myBookActionDivider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          style={styles.myBookActionBtn}
          onPress={handleDelete}
          disabled={deleteMutation.isPending}
          activeOpacity={0.6}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={[styles.myBookActionText, { color: colors.danger }]}>Sil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Tabs
  tabContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: radius.button,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.button - 2,
    overflow: 'hidden',
  },
  tabActive: {
    shadowColor: '#11806B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  tabGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.button - 2,
  },
  tabText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  tabBadge: {
    marginLeft: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: 2,
  },
  // Scroll
  scrollContent: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: 100,
  },
  // Book Card
  myBookCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  myBookCardInner: {
    flexDirection: 'row',
    padding: spacing.md,
  },
  myBookCoverWrap: {
    position: 'relative',
    marginRight: spacing.md,
  },
  myBookCover: {
    width: 72,
    height: 102,
    borderRadius: radius.field,
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  myBookCoverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0,
  },
  statusDot: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  myBookInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  myBookTitle: {
    fontSize: fontSize.body,
    fontWeight: '800',
    lineHeight: 20,
    marginBottom: 2,
  },
  myBookAuthor: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  myBookMeta: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  metaDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaPillText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  // Actions
  myBookActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  myBookActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: spacing.sm + 2,
  },
  myBookActionDivider: {
    width: 1,
    height: '60%',
    alignSelf: 'center',
  },
  myBookActionText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  // FAB
  fab: {
    position: 'absolute',
    bottom: spacing.xxl + 80,
    right: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  fabGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
