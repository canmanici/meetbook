import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  SectionListData,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  useColorScheme,
  Animated,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useShallow } from 'zustand/react/shallow';
import { Swipeable } from 'react-native-gesture-handler';
import { useToast } from '@/hooks/use-toast';

import {
  palette,
  pastels,
  spacing,
  fontSize,
  radius,
  shadows,
  type ThemeColors,
  type PastelName,
} from '@/components/ui/tokens';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/emptystate';
import { listChats, type ChatSummary } from '@/lib/api/chat';
import { authedRequest } from '@/lib/api/client';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterKey = 'all' | 'unread';

/** ChatSummary extended with per-user pin/mute fields returned by the API. */
type ChatRow = ChatSummary & {
  is_pinned?: boolean;
  muted_until?: string | null;
};

interface ChatSection {
  key: string;
  title: string;
  data: ChatRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Relative, compact time label for chat list rows. */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Şimdi';
  if (diffMins < 60) return `${diffMins}dk`;
  if (diffHours < 24) return `${diffHours}sa`;
  if (diffDays < 7) return `${diffDays}g`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

type SectionKey = 'pinned' | 'new' | 'today' | 'yesterday' | 'thisweek' | 'earlier';

function sectionKeyFor(dateStr: string | null): SectionKey {
  if (!dateStr) return 'new';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'thisweek';
  return 'earlier';
}

const SECTION_ORDER: { key: SectionKey; title: string }[] = [
  { key: 'pinned', title: 'Sabitlenenler' },
  { key: 'new', title: 'Yeni Sohbetler' },
  { key: 'today', title: 'Bugün' },
  { key: 'yesterday', title: 'Dün' },
  { key: 'thisweek', title: 'Bu Hafta' },
  { key: 'earlier', title: 'Daha Önce' },
];

/** Map a chat's last_message_type to a leading icon + fallback preview. */
const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  image: 'image-outline',
  voice: 'mic-outline',
  location: 'location-outline',
  book_card: 'book-outline',
  system: 'information-circle-outline',
};

const TYPE_FALLBACK: Record<string, string> = {
  image: 'Fotoğraf',
  voice: 'Sesli mesaj',
  location: 'Konum',
  book_card: 'Kitap kartı',
  system: 'Bilgi',
};

/** Deterministic pastel pick from a name — stable, warm accent ring per user. */
const PASTEL_KEYS = Object.keys(pastels.light) as PastelName[];
function pastelForName(name: string): PastelName {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PASTEL_KEYS[Math.abs(h) % PASTEL_KEYS.length];
}

// ---------------------------------------------------------------------------
// Swipe action backgrounds — left = archive (orange), right = pin (blue).
// Defined at module scope so they stay referentially stable across renders.
// ---------------------------------------------------------------------------

const renderLeftActions = () => (
  <View
    style={{
      backgroundColor: '#FF9500',
      justifyContent: 'center',
      paddingLeft: 20,
      flex: 1,
    }}
  >
    <Ionicons name="archive" size={24} color="#fff" />
    <Text style={{ color: '#fff', fontSize: 12 }}>Arşivle</Text>
  </View>
);

const renderRightActions = () => (
  <View
    style={{
      backgroundColor: '#007AFF',
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingRight: 20,
      flex: 1,
    }}
  >
    <Ionicons name="pin" size={24} color="#fff" />
    <Text style={{ color: '#fff', fontSize: 12 }}>Sabitle</Text>
  </View>
);

// ---------------------------------------------------------------------------
// PulseDot — animated status dot for the connection pill.
// ---------------------------------------------------------------------------

const PulseDot: React.FC<{ color: string; pulsing?: boolean }> = ({ color, pulsing = false }) => {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulsing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 650, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, scale]);
  return (
    <Animated.View
      style={[styles.statusDot, { backgroundColor: color, transform: [{ scale }] }]}
    />
  );
};

// ---------------------------------------------------------------------------
// ChatItem — memoized row. Receives only primitives so it skips re-renders
// when unrelated typing/presence events fire.
// ---------------------------------------------------------------------------

interface ChatItemProps {
  item: ChatRow;
  isOnline: boolean;
  isTyping: boolean;
  colors: ThemeColors;
  isDark: boolean;
  onPress: (exchangeId: string) => void;
  onLongPress: (exchangeId: string, chatId: string, isPinned: boolean) => void;
}

const ChatItem = React.memo<ChatItemProps>(
  ({ item, isOnline, isTyping, colors, isDark, onPress, onLongPress }) => {
    const hasUnread = item.unread_count > 0;
    const pastel = pastels[isDark ? 'dark' : 'light'][pastelForName(item.counterpart_name)];
    const typeIcon = TYPE_ICON[item.last_message_type];
    const previewText =
      item.last_message ?? TYPE_FALLBACK[item.last_message_type] ?? 'Henüz mesaj yok';
    const isSystem = item.last_message_type === 'system';
    const isPinned = item.is_pinned ?? false;

    return (
      <TouchableOpacity
        testID={`chat-row-${item.exchange_id}`}
        style={[
          styles.chatItem,
          {
            backgroundColor: hasUnread ? colors.primarySoft : colors.surface,
            borderColor: hasUnread ? colors.primary + '22' : colors.border,
          },
          shadows.card,
        ]}
        onPress={() => onPress(item.exchange_id)}
        onLongPress={() => onLongPress(item.exchange_id, item.chat_id, isPinned)}
        delayLongPress={400}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.counterpart_name} ile sohbeti aç`}
      >
        {hasUnread && <View style={[styles.unreadAccent, { backgroundColor: colors.primary }]} />}

        {/* Avatar with pastel ring + presence dot */}
        <View style={styles.avatarWrap}>
          <View style={[styles.avatarRing, { borderColor: pastel.bg }]}>
            <Avatar name={item.counterpart_name} size="medium" />
          </View>
          {isOnline && (
            <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
          )}
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.topRow}>
            <View style={styles.nameRow}>
              {isPinned && (
                <Ionicons
                  name="pin"
                  size={13}
                  color={colors.textMuted}
                  style={styles.pinIcon}
                />
              )}
              <Text
                style={[
                  styles.name,
                  { color: colors.text },
                  hasUnread && { fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {item.counterpart_name}
              </Text>
            </View>
            {item.last_message_at && (
              <Text
                style={[
                  styles.time,
                  { color: hasUnread ? colors.primary : colors.textMuted },
                  hasUnread && { fontWeight: '700' },
                ]}
              >
                {formatTime(item.last_message_at)}
              </Text>
            )}
          </View>

          <View style={styles.bottomRow}>
            {isTyping ? (
              <Text style={[styles.typingPreview, { color: colors.primary }]} numberOfLines={1}>
                yazıyor...
              </Text>
            ) : (
              <View style={styles.previewRow}>
                {typeIcon && (
                  <Ionicons
                    name={typeIcon}
                    size={13}
                    color={hasUnread ? colors.primary : colors.textMuted}
                    style={styles.previewIcon}
                  />
                )}
                <Text
                  style={[
                    styles.preview,
                    {
                      color: hasUnread ? colors.text : colors.textMuted,
                      fontStyle: isSystem ? 'italic' : 'normal',
                    },
                    hasUnread && { fontWeight: '600' },
                  ]}
                  numberOfLines={2}
                >
                  {previewText}
                </Text>
              </View>
            )}

            {hasUnread && (
              <LinearGradient
                colors={[colors.primary, isDark ? '#2EA88A' : '#0D5E4F']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.unreadBadge}
              >
                <Text style={styles.unreadText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </LinearGradient>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  },
);
ChatItem.displayName = 'ChatItem';

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

const SectionHeader: React.FC<{
  section: SectionListData<ChatRow, ChatSection>;
  colors: ThemeColors;
}> = ({ section, colors }) => (
  <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{section.title}</Text>
  </View>
);

// ---------------------------------------------------------------------------
// ChatListSkeleton
// ---------------------------------------------------------------------------

const ChatListSkeleton: React.FC<{ colors: ThemeColors }> = ({ colors }) => (
  <View style={styles.skeletonWrap}>
    {[0, 1, 2, 3, 4].map((i) => (
      <View
        key={i}
        testID="chat-skeleton"
        style={[styles.skeletonRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={[styles.skeletonCircle, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
        <View style={styles.skeletonBody}>
          <View style={[styles.skeletonLine, { width: '60%', backgroundColor: colors.textMuted, opacity: 0.15 }]} />
          <View style={[styles.skeletonLine, { width: '85%', backgroundColor: colors.textMuted, opacity: 0.12 }]} />
        </View>
      </View>
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ChatsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const connected = useChatStore((s) => s.connected);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);
  // Whole-object subscribe is fine — list is small and items are memoized.
  const typing = useChatStore(useShallow((s) => s.typing));
  const presence = useChatStore(useShallow((s) => s.presence));

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['chats'],
    queryFn: listChats,
    refetchInterval: 15000,
    retry: false,
  });

  useFocusEffect(
    useCallback(() => {
      connect();
      return () => disconnect();
    }, []),
  );

  const allChats = data?.items ?? [];
  const totalUnread = useMemo(
    () => allChats.reduce((sum, c) => sum + (c.unread_count > 0 ? 1 : 0), 0),
    [allChats],
  );

  // Filter + search, then group into date sections.
  const sections = useMemo<ChatSection[]>(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    const filtered = allChats.filter((c) => {
      if (filter === 'unread' && c.unread_count <= 0) return false;
      if (!q) return true;
      return (
        c.counterpart_name.toLocaleLowerCase('tr-TR').includes(q) ||
        (c.last_message ?? '').toLocaleLowerCase('tr-TR').includes(q)
      );
    });

    const buckets: Record<SectionKey, ChatSummary[]> = {
      pinned: [],
      new: [],
      today: [],
      yesterday: [],
      thisweek: [],
      earlier: [],
    };
    for (const c of filtered) {
      if (c.is_pinned) {
        buckets.pinned.push(c);
      } else {
        buckets[sectionKeyFor(c.last_message_at)].push(c);
      }
    }

    // Sort each bucket by last_message_at desc (new chats sink within "new").
    const sortFn = (a: ChatSummary, b: ChatSummary) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    };
    for (const k of Object.keys(buckets) as SectionKey[]) buckets[k].sort(sortFn);

    return SECTION_ORDER.filter((s) => buckets[s.key].length > 0).map((s) => ({
      key: s.key,
      title: s.title,
      data: buckets[s.key],
    }));
  }, [allChats, filter, query]);

  const handlePress = useCallback((exchangeId: string) => {
    router.push(`/chat/${exchangeId}`);
  }, [router]);

  const handleArchive = useCallback(
    (_chatId: string) => {
      toast.show('Sohbet arşivlendi', { variant: 'info' });
    },
    [toast],
  );

  const handlePinChat = useCallback(
    async (exchangeId: string) => {
      try {
        await authedRequest(`/exchanges/${exchangeId}/chat/pin`, 'PATCH', undefined);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        toast.show('Sohbet sabitlendi', { variant: 'success' });
      } catch {
        toast.show('Sabitleme başarısız', { variant: 'error' });
      }
    },
    [queryClient, toast],
  );

  const handleUnpinChat = useCallback(
    async (exchangeId: string) => {
      try {
        await authedRequest(`/exchanges/${exchangeId}/chat/unpin`, 'PATCH', undefined);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        toast.show('Sabitleme kaldırıldı', { variant: 'info' });
      } catch {
        toast.show('İşlem başarısız', { variant: 'error' });
      }
    },
    [queryClient, toast],
  );

  const handleLongPress = useCallback(
    (exchangeId: string, _chatId: string, isPinned: boolean) => {
      Alert.alert(
        isPinned ? 'Sohbeti Bırak' : 'Sohbeti Sabitle',
        isPinned
          ? 'Bu sohbetin sabitlemesini kaldırmak istiyor musunuz?'
          : 'Bu sohbeti en üste sabitlemek istiyor musunuz?',
        [
          { text: 'İptal', style: 'cancel' },
          {
            text: isPinned ? 'Sabitlemeyi Kaldır' : 'Sabitle',
            onPress: () => {
              if (isPinned) {
                handleUnpinChat(exchangeId);
              } else {
                handlePinChat(exchangeId);
              }
            },
          },
        ],
      );
    },
    [handlePinChat, handleUnpinChat],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatRow }) => {
      const isOnline = presence[item.counterpart_id]?.is_online ?? false;
      const chatTyping = typing[item.chat_id] ?? {};
      const isTyping = Object.entries(chatTyping).some(
        ([uid, t]) => t && uid !== currentUserId,
      );
      const isPinned = item.is_pinned ?? false;
      return (
        <Swipeable
          renderLeftActions={renderLeftActions}
          renderRightActions={renderRightActions}
          onSwipeableOpen={(direction, swipeable) => {
            swipeable.close();
            if (direction === 'left') {
              handleArchive(item.chat_id);
            } else {
              if (isPinned) {
                handleUnpinChat(item.exchange_id);
              } else {
                handlePinChat(item.exchange_id);
              }
            }
          }}
        >
          <ChatItem
            item={item}
            isOnline={isOnline}
            isTyping={isTyping}
            colors={colors}
            isDark={isDark}
            onPress={handlePress}
            onLongPress={handleLongPress}
          />
        </Swipeable>
      );
    },
    [
      presence,
      typing,
      currentUserId,
      colors,
      isDark,
      handlePress,
      handleArchive,
      handlePinChat,
      handleUnpinChat,
      handleLongPress,
    ],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<ChatRow, ChatSection> }) => (
      <SectionHeader section={section} colors={colors} />
    ),
    [colors],
  );

  const isEmpty = !isLoading && allChats.length === 0;
  const isNoResults = !isLoading && allChats.length > 0 && sections.length === 0;

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: allChats.length },
    { key: 'unread', label: 'Okunmamış', count: totalUnread },
  ];

  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <EmptyState
          message="Sohbetler yüklenemedi"
          description="Bağlantınızı kontrol edip tekrar deneyin."
          actionLabel="Tekrar Dene"
          onAction={() => refetch()}
          icon="cloud-offline"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Mesajlar</Text>
          {totalUnread > 0 && (
            <View style={[styles.headerBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: (connected ? colors.success : colors.warning) + '1F' },
          ]}
        >
          <PulseDot color={connected ? colors.success : colors.warning} pulsing={!connected} />
          <Text style={[styles.statusText, { color: connected ? colors.success : colors.warning }]}>
            {connected ? 'Bağlı' : 'Bağlanıyor'}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Sohbet ara..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            testID="chat-search-input"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.searchClear} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter segmented control */}
      <View style={styles.filterRow}>
        <View style={[styles.filterSegment, { backgroundColor: colors.surfaceAlt }]}>
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`filter-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={[styles.filterTab, active && styles.filterTabActive]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={f.key === 'all' ? 'Tüm sohbetler' : 'Okunmamış sohbetler'}
              >
                {active && (
                  <LinearGradient
                    colors={[colors.primary, colors.primary + 'DD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.filterGradient}
                  />
                )}
                <Text
                  style={[
                    styles.filterText,
                    { color: active ? '#fff' : colors.textMuted },
                  ]}
                >
                  {f.label}
                </Text>
                {f.count > 0 && (
                  <View
                    style={[
                      styles.filterCount,
                      { backgroundColor: active ? '#FFFFFF33' : colors.primary + '1F' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterCountText,
                        { color: active ? '#fff' : colors.primary },
                      ]}
                    >
                      {f.count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* List */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.chat_id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 96 },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          isLoading ? (
            <ChatListSkeleton colors={colors} />
          ) : isNoResults ? (
            <EmptyState
              icon="search-outline"
              message="Sonuç bulunamadı"
              description={query ? `"${query}" için sohbet yok` : 'Bu filtreye uyan sohbet yok'}
            />
          ) : isEmpty ? (
            <EmptyState
              icon="chatbubbles"
              message="Henüz Sohbet Yok"
              description="Bir kitap talebi kabul edildiğinde burada görünecek"
              actionLabel="Kitaplara Göz At"
              onAction={() => router.push('/tabs/home')}
            />
          ) : null
        }
      />

      {/* Book club FAB */}
      <LinearGradient
        colors={[colors.primary, isDark ? '#2EA88A' : '#0D5E4F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fab, { bottom: insets.bottom + spacing.xl }]}
      >
        <TouchableOpacity
          onPress={() => router.push('/chat/club/create')}
          style={styles.fabTouch}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Kitap kulübü oluştur"
          testID="create-club-fab"
        >
          <Ionicons name="people" size={26} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBadgeText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  // Search
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: fontSize.bodySm,
    padding: 0,
  },
  searchClear: {
    padding: spacing.xs,
  },
  // Filter
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filterSegment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    gap: 4,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  filterTabActive: {
    // gradient drawn on top via filterGradient
  },
  filterGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
  },
  filterText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  filterCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '800',
  },
  // List
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  sectionHeader: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Chat item
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.md + 2,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  unreadAccent: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 2,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: spacing.md,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  pinIcon: {
    marginRight: 2,
    marginTop: 1,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.sm,
  },
  time: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  previewIcon: {
    marginRight: 5,
    marginTop: 1,
  },
  preview: {
    flex: 1,
    fontSize: fontSize.bodySm,
    lineHeight: 18,
  },
  typingPreview: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  unreadBadge: {
    borderRadius: radius.pill,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  unreadText: {
    color: '#ffffff',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  // Skeleton
  skeletonWrap: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  skeletonCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: spacing.md,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },
  // Book club FAB
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabTouch: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
