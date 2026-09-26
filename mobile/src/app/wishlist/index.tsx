import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Input, EmptyState, Skeleton, Sheet, palette, spacing, radius, fontSize, shadows } from '@/components/ui';
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  getWishlistMatches,
  authedRequest,
  WishlistItem,
} from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

function buildAddPayload(input: string): { isbn: string } | { title: string } {
  const trimmed = input.trim();
  const cleaned = trimmed.replace(/[- ]/g, '');
  if (/^\d{9}[\dX]$/.test(cleaned) || /^\d{13}$/.test(cleaned)) {
    return { isbn: cleaned };
  }
  return { title: trimmed };
}

function buildSharedItemPayload(input: string): { isbn?: string; title: string; author?: string } {
  const trimmed = input.trim();
  const cleaned = trimmed.replace(/[- ]/g, '');
  if (/^\d{9}[\dX]$/.test(cleaned) || /^\d{13}$/.test(cleaned)) {
    return { isbn: cleaned, title: trimmed };
  }
  return { title: trimmed };
}

const WISHLIST_PRIORITIES_KEY = 'meetbook-wishlist-priorities';

type WishlistPriority = 'high' | 'medium' | 'low';
type SortMode = 'date' | 'alpha' | 'priority';
type WishlistRow = WishlistItem & { priority: WishlistPriority };
type WishlistTab = 'personal' | 'shared';

type SharedWishlistMemberView = {
  user_id: string;
  name: string;
  is_owner: boolean;
  joined_at: string;
};

type SharedWishlistItemView = {
  id: string;
  wishlist_id: string;
  added_by: string;
  added_by_name: string;
  isbn?: string;
  title: string;
  author?: string;
  created_at: string;
};

type SharedWishlistView = {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  created_at: string;
  members: SharedWishlistMemberView[];
  items: SharedWishlistItemView[];
};

type SharedWishlistListResponse = { items: SharedWishlistView[] };

const PRIORITY_ORDER: Record<WishlistPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PRIORITY_LABELS: Record<WishlistPriority, string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
};

const SORT_OPTIONS: SortMode[] = ['date', 'alpha', 'priority'];
const SORT_LABELS: Record<SortMode, string> = {
  date: 'Eklenme Tarihi',
  alpha: 'Ada Göre (A-Z)',
  priority: 'Öncelik',
};

const DEFAULT_PRIORITY: WishlistPriority = 'medium';

export default function WishlistScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [isbn, setIsbn] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [priorities, setPriorities] = useState<Record<string, WishlistPriority>>({});
  const [sheetItem, setSheetItem] = useState<WishlistItem | null>(null);

  // Shared wishlist UI state
  const [tab, setTab] = useState<WishlistTab>('personal');
  const [selectedSharedId, setSelectedSharedId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [sharedItemInput, setSharedItemInput] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [addMemberSheet, setAddMemberSheet] = useState(false);
  const [addToSharedSheet, setAddToSharedSheet] = useState(false);
  const [sharedRefreshing, setSharedRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(WISHLIST_PRIORITIES_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          setPriorities(JSON.parse(raw) as Record<string, WishlistPriority>);
        } catch {
          // ignore corrupted payload
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(WISHLIST_PRIORITIES_KEY, JSON.stringify(priorities)).catch(
      () => undefined,
    );
  }, [priorities]);

  const setItemPriority = useCallback((itemId: string, priority: WishlistPriority) => {
    setPriorities((prev) => ({ ...prev, [itemId]: priority }));
  }, []);

  const { data: wishlistData, isLoading: wishlistLoading, isError: wishlistError, refetch: refetchWishlist } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
    retry: false,
  });

  const { data: matchesData, isLoading: matchesLoading, refetch: refetchMatches } = useQuery({
    queryKey: ['wishlist-matches'],
    queryFn: getWishlistMatches,
  });

  // Shared wishlist list — only fetched when the shared tab is visible or the
  // "add to shared" sheet is open. Gating keeps the personal view (and its
  // tests, which mock the API client without authedRequest) unaffected.
  const sharedListEnabled = tab === 'shared' || addToSharedSheet;
  const { data: sharedListData, isLoading: sharedListLoading, refetch: refetchSharedList } = useQuery({
    queryKey: ['shared-wishlists'],
    queryFn: () => authedRequest<SharedWishlistListResponse>('/wishlist/shared', 'GET', undefined),
    enabled: sharedListEnabled,
    retry: false,
  });

  const { data: selectedShared, refetch: refetchSelectedShared } = useQuery({
    queryKey: ['shared-wishlist', selectedSharedId],
    queryFn: () => authedRequest<SharedWishlistView>(`/wishlist/shared/${selectedSharedId}`, 'GET', undefined),
    enabled: !!selectedSharedId,
    retry: false,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchWishlist(), refetchMatches()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchWishlist, refetchMatches]);

  const handleSharedRefresh = useCallback(async () => {
    setSharedRefreshing(true);
    try {
      const tasks: Promise<unknown>[] = [refetchSharedList()];
      if (selectedSharedId) tasks.push(refetchSelectedShared());
      await Promise.all(tasks);
    } finally {
      setSharedRefreshing(false);
    }
  }, [refetchSharedList, refetchSelectedShared, selectedSharedId]);

  const addMutation = useMutation({
    mutationFn: addToWishlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-matches'] });
      setIsbn('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeFromWishlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-matches'] });
    },
  });

  const invalidateSharedQueries = useCallback(
    (id?: string) => {
      queryClient.invalidateQueries({ queryKey: ['shared-wishlists'] });
      if (id) {
        queryClient.invalidateQueries({ queryKey: ['shared-wishlist', id] });
      }
    },
    [queryClient],
  );

  const createSharedMutation = useMutation({
    mutationFn: (name: string) =>
      authedRequest<SharedWishlistView>('/wishlist/shared', 'POST', { name }),
    onSuccess: (created) => {
      invalidateSharedQueries();
      setNewListName('');
      setSelectedSharedId(created.id);
    },
  });

  const addSharedItemMutation = useMutation({
    mutationFn: (args: { id: string; body: { isbn?: string; title: string; author?: string } }) =>
      authedRequest<SharedWishlistItemView>(`/wishlist/shared/${args.id}/items`, 'POST', args.body),
    onSuccess: () => {
      invalidateSharedQueries(selectedSharedId ?? undefined);
      setSharedItemInput('');
      setAddToSharedSheet(false);
      setIsbn('');
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: (args: { id: string; email: string }) =>
      authedRequest<void>(`/wishlist/shared/${args.id}/members`, 'POST', { email: args.email }),
    onSuccess: () => {
      invalidateSharedQueries(selectedSharedId ?? undefined);
      setMemberEmail('');
      setAddMemberSheet(false);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (args: { id: string; userId: string }) =>
      authedRequest<void>(`/wishlist/shared/${args.id}/members/${args.userId}`, 'DELETE', undefined),
    onSuccess: () => {
      invalidateSharedQueries(selectedSharedId ?? undefined);
    },
  });

  const items = useMemo(() => wishlistData?.items ?? [], [wishlistData]);
  const matches = matchesData?.matches ?? [];
  const sharedWishlists = sharedListData?.items ?? [];

  const priorityColor: Record<WishlistPriority, string> = {
    high: colors.danger,
    medium: colors.warning,
    low: colors.textMuted,
  };

  const sortedRows: WishlistRow[] = useMemo(() => {
    const rows: WishlistRow[] = items.map((it) => ({
      ...it,
      priority: priorities[it.id] ?? DEFAULT_PRIORITY,
    }));
    const byDateDesc = (a: WishlistRow, b: WishlistRow) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    switch (sortMode) {
      case 'alpha':
        return [...rows].sort((a, b) =>
          (a.title || a.isbn || '').localeCompare(b.title || b.isbn || '', 'tr'),
        );
      case 'priority':
        return [...rows].sort((a, b) => {
          const d = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          return d !== 0 ? d : byDateDesc(a, b);
        });
      case 'date':
      default:
        return [...rows].sort(byDateDesc);
    }
  }, [items, priorities, sortMode]);

  const hasMatch = (item: { isbn?: string | null; title?: string | null }): boolean => {
    if (item.isbn) return matches.some((m) => m.isbn === item.isbn);
    // Title-only entries are matched server-side by (case-insensitive) title.
    const t = item.title?.trim().toLocaleLowerCase('tr');
    return !!t && matches.some((m) => m.title?.trim().toLocaleLowerCase('tr') === t);
  };

  if (wishlistError && tab === 'personal' && !selectedSharedId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <EmptyState
          message="İstek listesi yüklenemedi"
          description="Bağlantınızı kontrol edip tekrar deneyin."
          actionLabel="Tekrar Dene"
          onAction={() => refetchWishlist()}
          icon="cloud-offline"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.textMuted + '15' }]}>
        {selectedShared ? (
          <View style={styles.detailHeader}>
            <TouchableOpacity
              onPress={() => setSelectedSharedId(null)}
              style={styles.backButton}
              testID="shared-back"
              accessibilityRole="button"
              accessibilityLabel="Geri"
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>
              {selectedShared.name}
            </Text>
            {currentUserId && currentUserId === selectedShared.owner_id && (
              <TouchableOpacity
                onPress={() => setAddMemberSheet(true)}
                style={[styles.memberAddBtn, { backgroundColor: colors.primary }]}
                testID="shared-add-member"
                accessibilityRole="button"
                accessibilityLabel="Üye ekle"
              >
                <Ionicons name="person-add-outline" size={20} color={colors.surface} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>İstek Listesi</Text>
            <View style={styles.tabRow}>
              <TouchableOpacity
                onPress={() => setTab('personal')}
                style={[styles.tab, tab === 'personal' && { backgroundColor: colors.primary + '18' }]}
                testID="tab-personal"
                accessibilityRole="button"
                accessibilityLabel="Kişisel liste"
                accessibilityState={{ selected: tab === 'personal' }}
              >
                <Text style={[styles.tabText, { color: tab === 'personal' ? colors.primary : colors.textMuted }]}>
                  Kişisel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTab('shared')}
                style={[styles.tab, tab === 'shared' && { backgroundColor: colors.primary + '18' }]}
                testID="tab-shared"
                accessibilityRole="button"
                accessibilityLabel="Ortak listeler"
                accessibilityState={{ selected: tab === 'shared' }}
              >
                <Text style={[styles.tabText, { color: tab === 'shared' ? colors.primary : colors.textMuted }]}>
                  Ortak
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {selectedShared ? (
        <ScrollView
          testID="shared-detail-scroll"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={sharedRefreshing}
              onRefresh={handleSharedRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <View style={[styles.sharedAddRow, { backgroundColor: colors.surface }]}>
            <Input
              placeholder="Kitap adı veya ISBN"
              value={sharedItemInput}
              onChangeText={setSharedItemInput}
              style={styles.sharedAddInput}
              testID="shared-item-input"
            />
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (sharedItemInput.trim() && selectedSharedId) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  addSharedItemMutation.mutate({
                    id: selectedSharedId,
                    body: buildSharedItemPayload(sharedItemInput),
                  });
                }
              }}
              disabled={!sharedItemInput.trim() || addSharedItemMutation.isPending}
              testID="shared-add-item-button"
              accessibilityRole="button"
              accessibilityLabel="Ortak listeye kitap ekle"
            >
              <Ionicons name="add" size={24} color={colors.surface} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Üyeler ({selectedShared.members.length})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.membersScroll}
          >
            {selectedShared.members.map((member) => {
              const canRemove =
                !!currentUserId &&
                currentUserId === selectedShared.owner_id &&
                !member.is_owner;
              return (
                <View
                  key={member.user_id}
                  style={[styles.memberChip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <Ionicons
                    name={member.is_owner ? 'star' : 'person-outline'}
                    size={14}
                    color={member.is_owner ? colors.warning : colors.textMuted}
                  />
                  <Text style={[styles.memberChipText, { color: colors.text }]} numberOfLines={1}>
                    {member.name || 'Üye'}
                    {member.user_id === currentUserId ? ' (sen)' : ''}
                  </Text>
                  {canRemove && (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        removeMemberMutation.mutate({ id: selectedShared.id, userId: member.user_id });
                      }}
                      testID={`shared-remove-member-${member.user_id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Üyeyi çıkar: ${member.name}`}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Kitaplar ({selectedShared.items.length})
          </Text>
          {selectedShared.items.length === 0 ? (
            <EmptyState
              message="Bu listede henüz kitap yok"
              description="Bir kitap eklemek için yukarıdaki alanı kullanın"
            />
          ) : (
            selectedShared.items.map((item) => (
              <View
                key={item.id}
                style={[styles.sharedItemCard, { backgroundColor: colors.surface }]}
                testID={`shared-item-${item.id}`}
              >
                <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]}>
                  <Ionicons name="book-outline" size={24} color={colors.textMuted} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.author && (
                    <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.author}
                    </Text>
                  )}
                  <View style={styles.statusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: colors.primary + '20' }]}>
                      <Ionicons name="person-outline" size={12} color={colors.primary} />
                      <Text style={[styles.sharedItemMeta, { color: colors.primary }]} numberOfLines={1}>
                        {item.added_by_name || 'Üye'}
                      </Text>
                    </View>
                    {item.isbn && (
                      <View style={[styles.statusBadge, { backgroundColor: colors.textMuted + '20' }]}>
                        <Text style={[styles.sharedItemMeta, { color: colors.textMuted }]} numberOfLines={1}>
                          ISBN {item.isbn}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}

          {currentUserId && currentUserId !== selectedShared.owner_id && (
            <TouchableOpacity
              style={[styles.leaveButton, { borderColor: colors.danger }]}
              onPress={() => {
                if (!selectedSharedId || !currentUserId) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                removeMemberMutation.mutate(
                  { id: selectedSharedId, userId: currentUserId },
                  { onSuccess: () => setSelectedSharedId(null) },
                );
              }}
              testID="shared-leave"
              accessibilityRole="button"
              accessibilityLabel="Listeden ayrıl"
            >
              <Text style={[styles.leaveButtonText, { color: colors.danger }]}>Listeden Ayrıl</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : tab === 'shared' ? (
        <>
          <View style={[styles.sharedAddRow, { backgroundColor: colors.surface }]}>
            <Input
              placeholder="Yeni ortak liste adı"
              value={newListName}
              onChangeText={setNewListName}
              style={styles.sharedAddInput}
              testID="shared-name-input"
            />
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (newListName.trim()) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  createSharedMutation.mutate(newListName.trim());
                }
              }}
              disabled={!newListName.trim() || createSharedMutation.isPending}
              testID="shared-create-button"
              accessibilityRole="button"
              accessibilityLabel="Yeni ortak liste oluştur"
            >
              <Ionicons name="add" size={24} color={colors.surface} />
            </TouchableOpacity>
          </View>

          <ScrollView
            testID="shared-scroll"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={sharedRefreshing}
                onRefresh={handleSharedRefresh}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
          >
            {sharedListLoading ? (
              <>
                <Skeleton variant="card" />
                <Skeleton variant="card" />
              </>
            ) : sharedWishlists.length === 0 ? (
              <EmptyState
                message="Ortak listeniz yok"
                description="Arkadaşlarınızla paylaşılan bir liste oluşturun. Eklediğiniz kitapları tüm üyeler görür."
              />
            ) : (
              sharedWishlists.map((wl) => {
                const isOwner = !!currentUserId && currentUserId === wl.owner_id;
                return (
                  <TouchableOpacity
                    key={wl.id}
                    style={[styles.sharedCard, { backgroundColor: colors.surface }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedSharedId(wl.id);
                    }}
                    testID={`shared-card-${wl.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Ortak listeyi aç: ${wl.name}`}
                  >
                    <View style={[styles.cover, styles.sharedCardCover, { backgroundColor: colors.primary + '18' }]}>
                      <Ionicons name="people" size={24} color={colors.primary} />
                    </View>
                    <View style={styles.cardContent}>
                      <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                        {wl.name}
                      </Text>
                      <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                        {isOwner ? 'Sahip: Sen' : `Sahip: ${wl.owner_name || 'Bilinmiyor'}`}
                      </Text>
                      <View style={styles.statusRow}>
                        <View style={[styles.statusBadge, { backgroundColor: colors.primary + '20' }]}>
                          <Ionicons name="person-outline" size={12} color={colors.primary} />
                          <Text style={[styles.sharedItemMeta, { color: colors.primary }]}>
                            {wl.members.length} üye
                          </Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: colors.textMuted + '20' }]}>
                          <Ionicons name="book-outline" size={12} color={colors.textMuted} />
                          <Text style={[styles.sharedItemMeta, { color: colors.textMuted }]}>
                            {wl.items.length} kitap
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </>
      ) : (
        <>
          <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
            <Input
              placeholder="Kitap adı veya ISBN"
              value={isbn}
              onChangeText={setIsbn}
              style={styles.searchInput}
              testID="wishlist-search-input"
            />
            <TouchableOpacity
              style={[styles.ortakButton, { borderColor: colors.primary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setAddToSharedSheet(true);
              }}
              disabled={!isbn.trim()}
              testID="wishlist-add-shared-button"
              accessibilityRole="button"
              accessibilityLabel="Ortak listeye ekle"
            >
              <Ionicons name="people-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (isbn.trim()) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  addMutation.mutate(buildAddPayload(isbn));
                }
              }}
              disabled={!isbn.trim() || addMutation.isPending}
              testID="wishlist-add-button"
              accessibilityRole="button"
              accessibilityLabel="İstek listesine ekle"
            >
              <Ionicons name="add" size={24} color={colors.surface} />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.sortChipScroll}
            contentContainerStyle={styles.sortChipRow}
          >
            {SORT_OPTIONS.map((option) => {
              const isActive = sortMode === option;
              return (
                <TouchableOpacity
                  key={option}
                  onPress={() => setSortMode(option)}
                  style={[
                    styles.sortChip,
                    {
                      backgroundColor: isActive ? colors.primary : colors.surfaceAlt,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  testID={`sort-${option}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${SORT_LABELS[option]} sıralaması`}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      { color: isActive ? '#fff' : colors.textMuted },
                    ]}
                  >
                    {SORT_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView
            testID="wishlist-scroll"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
            }
          >
            {wishlistLoading || matchesLoading ? (
              <>
                <Skeleton variant="card" />
                <Skeleton variant="card" />
                <Skeleton variant="card" />
              </>
            ) : items.length === 0 ? (
              <EmptyState
                message="İstek listesi boş"
                description="Kitap eklemek için yukarıdaki alana ISBN veya kitap adı yazın"
              />
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitaplarım</Text>
                {sortedRows.map((item) => (
                  <View
                    key={item.id}
                    style={[styles.wishlistCard, { backgroundColor: colors.surface }]}
                    testID={`wishlist-card-${item.id}`}
                  >
                    <TouchableOpacity
                      style={styles.cardMain}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSheetItem(item);
                      }}
                      testID={`wishlist-priority-open-${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Öncelik değiştir: ${item.title || item.isbn}`}
                    >
                      <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]}>
                        <Ionicons name="book-outline" size={24} color={colors.textMuted} />
                        <View
                          style={[styles.priorityDot, { backgroundColor: priorityColor[item.priority] }]}
                          testID={`wishlist-priority-dot-${item.id}`}
                        />
                      </View>
                      <View style={styles.cardContent}>
                        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                          {item.title || item.isbn}
                        </Text>
                        {item.author && (
                          <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                            {item.author}
                          </Text>
                        )}
                        <View style={styles.statusRow}>
                          {hasMatch(item) ? (
                            <View style={[styles.statusBadge, { backgroundColor: colors.success + '20' }]}>
                              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                              <Text style={[styles.statusText, { color: colors.success }]}>Eşleşme bulundu</Text>
                            </View>
                          ) : (
                            <View style={[styles.statusBadge, { backgroundColor: colors.warning + '20' }]}>
                              <Ionicons name="time-outline" size={14} color={colors.warning} />
                              <Text style={[styles.statusText, { color: colors.warning }]}>Bekleniyor</Text>
                            </View>
                          )}
                          <View style={[styles.priorityBadge, { backgroundColor: priorityColor[item.priority] + '22' }]}>
                            <View style={[styles.priorityBadgeDot, { backgroundColor: priorityColor[item.priority] }]} />
                            <Text style={[styles.priorityBadgeText, { color: priorityColor[item.priority] }]}>
                              {PRIORITY_LABELS[item.priority]}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.removeButton, { backgroundColor: colors.danger + '15' }]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        removeMutation.mutate(item.id);
                      }}
                      testID={`wishlist-remove-${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel="İstek listesinden çıkar"
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}

                {matches.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Yakınınızda Eşleşenler</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.matchesScroll}
                    >
                      {matches.map((match) => (
                        <TouchableOpacity
                          key={match.id}
                          style={[styles.matchCard, { backgroundColor: colors.surface }]}
                          onPress={() => router.push(`/book/${match.id}`)}
                          testID={`match-card-${match.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Eşleşen kitabı görüntüle: ${match.title}`}
                        >
                          <View style={[styles.matchCover, { backgroundColor: colors.textMuted + '30' }]}>
                            {match.photos?.[0]?.url ? (
                              <Image
                                source={{ uri: match.photos[0].url }}
                                style={styles.matchCoverImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                transition={200}
                              />
                            ) : (
                              <Ionicons name="book-outline" size={20} color={colors.textMuted} />
                            )}
                            <View style={[styles.distanceBadge, { backgroundColor: colors.primary }]}>
                              <Text style={styles.distanceBadgeText}>{match.distance_km.toFixed(1)} km</Text>
                            </View>
                          </View>
                          <View style={styles.matchInfo}>
                            <Text style={[styles.matchTitle, { color: colors.text }]} numberOfLines={1}>
                              {match.title}
                            </Text>
                            {match.author && (
                              <Text style={[styles.matchAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                                {match.author}
                              </Text>
                            )}
                            <TouchableOpacity
                              style={[styles.exchangeButton, { backgroundColor: colors.primary }]}
                              onPress={() => router.push(`/book/${match.id}`)}
                              testID={`exchange-request-${match.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Takas iste"
                            >
                              <Text style={styles.exchangeButtonText}>Takas İste</Text>
                            </TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </>
      )}

      <Sheet
        visible={sheetItem !== null}
        onClose={() => setSheetItem(null)}
        title="Öncelik Seç"
      >
        {sheetItem && (
          <View style={styles.sheetList}>
            {(['high', 'medium', 'low'] as WishlistPriority[]).map((p) => {
              const selected = (priorities[sheetItem.id] ?? DEFAULT_PRIORITY) === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.sheetRow, selected && { backgroundColor: palette.light.primary + '14' }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setItemPriority(sheetItem.id, p);
                    setSheetItem(null);
                  }}
                  testID={`priority-option-${p}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Öncelik: ${PRIORITY_LABELS[p]}`}
                  accessibilityState={{ selected }}
                >
                  <View style={[styles.sheetDot, { backgroundColor: priorityColor[p] }]} />
                  <Text style={[styles.sheetRowText, { color: palette.light.text }]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={18} color={palette.light.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Sheet>

      <Sheet
        visible={addMemberSheet}
        onClose={() => setAddMemberSheet(false)}
        title="Üye Ekle"
      >
        <View style={styles.sheetList}>
          <Input
            placeholder="E-posta adresi"
            value={memberEmail}
            onChangeText={setMemberEmail}
            style={styles.sheetInput}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="member-email-input"
          />
          <TouchableOpacity
            style={[styles.sheetActionButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (memberEmail.trim() && selectedSharedId) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                addMemberMutation.mutate({ id: selectedSharedId, email: memberEmail.trim() });
              }
            }}
            disabled={!memberEmail.trim() || addMemberMutation.isPending}
            testID="member-add-confirm"
            accessibilityRole="button"
            accessibilityLabel="Üyeyi ekle"
          >
            <Text style={styles.sheetActionButtonText}>Ekle</Text>
          </TouchableOpacity>
          {addMemberMutation.isError && (
            <Text style={[styles.sheetError, { color: colors.danger }]} testID="member-add-error">
              {memberEmail.trim() ? 'Kullanıcı bulunamadı veya zaten üye.' : ''}
            </Text>
          )}
        </View>
      </Sheet>

      <Sheet
        visible={addToSharedSheet}
        onClose={() => setAddToSharedSheet(false)}
        title="Ortak Listeye Ekle"
      >
        <View style={styles.sheetList}>
          <Text style={[styles.sheetHint, { color: colors.textMuted }]} numberOfLines={2}>
            “{isbn.trim() || 'Kitap'}” kitabını eklemek için bir ortak liste seçin.
          </Text>
          {sharedListLoading ? (
            <Skeleton variant="card" />
          ) : sharedWishlists.length === 0 ? (
            <Text style={[styles.sheetHint, { color: colors.textMuted }]}>
              Önce bir ortak liste oluşturun.
            </Text>
          ) : (
            sharedWishlists.map((wl) => (
              <TouchableOpacity
                key={wl.id}
                style={[styles.sheetRow, { borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => {
                  if (isbn.trim()) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    addSharedItemMutation.mutate({
                      id: wl.id,
                      body: buildSharedItemPayload(isbn),
                    });
                  }
                }}
                testID={`add-to-shared-${wl.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Şuraya ekle: ${wl.name}`}
              >
                <Ionicons name="people" size={18} color={colors.primary} />
                <Text style={[styles.sheetRowText, { color: colors.text }]} numberOfLines={1}>
                  {wl.name}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tab: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  tabText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    marginBottom: 0,
  },
  ortakButton: {
    width: 44,
    height: 44,
    borderRadius: radius.input,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: radius.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  wishlistCard: {
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  statusText: {
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
  matchesScroll: {
    paddingRight: spacing.lg,
  },
  matchCard: {
    width: 160,
    borderRadius: radius.input,
    marginRight: spacing.sm,
    overflow: 'hidden',
    ...shadows.card,
  },
  matchCover: {
    width: '100%',
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchCoverImage: {
    width: '100%',
    height: '100%',
  },
  distanceBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  distanceBadgeText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  matchInfo: {
    padding: spacing.sm,
  },
  matchTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: 2,
  },
  matchAuthor: {
    fontSize: fontSize.caption,
    marginBottom: spacing.sm,
  },
  exchangeButton: {
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  exchangeButtonText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityDot: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginLeft: spacing.xs,
    gap: spacing.xs,
  },
  priorityBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  priorityBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  sortChipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  sortChipRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },
  sortChip: {
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sortChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  sheetList: {
    gap: spacing.xs,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.input,
    gap: spacing.sm,
  },
  sheetDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  sheetRowText: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  sheetInput: {
    marginBottom: 0,
  },
  sheetActionButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  sheetActionButtonText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  sheetHint: {
    fontSize: fontSize.bodySm,
  },
  sheetError: {
    fontSize: fontSize.caption,
  },
  // Shared wishlist styles
  sharedAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  sharedAddInput: {
    flex: 1,
    marginBottom: 0,
  },
  sharedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  sharedCardCover: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sharedItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  sharedItemMeta: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  membersScroll: {
    paddingRight: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: spacing.xs,
    gap: spacing.xs,
    maxWidth: 180,
  },
  memberChipText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  leaveButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.input,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  leaveButtonText: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
});
