import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { spacing, fontSize, radius, palette, shadows } from '@/components/ui/tokens';
import { Avatar } from '@/components/ui/avatar';
import { MessageBubble } from '@/components/ui/message-bubble';
import { TypingIndicator } from '@/components/ui/typing-indicator';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getMessages,
  listChats,
  markMessagesRead,
  searchMessages,
  type MessageView,
  type MessageListResponse,
} from '@/lib/api/chat';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { useShadowBlocked } from '@/hooks/use-shadow-blocked';
import { getExchange, listMyBooks, type BookListResponse } from '@/lib/api/client';
import { BookCover } from '@/components/ui/book-cover';

// ---------------------------------------------------------------------------
// Date separator helpers
// ---------------------------------------------------------------------------

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = today.getTime() - msgDay.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) {
    const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageListItem =
  | { type: 'date'; date: string; key: string }
  | { type: 'typing'; key: string }
  | { type: 'message'; message: MessageView; key: string };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ChatDetailScreen() {
  const { id: exchangeId } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { shadowBlocked, isBlocked, reload: reloadShadowBlocked } = useShadowBlocked();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const sendDelete = useChatStore((s) => s.sendDelete);
  const sendReaction = useChatStore((s) => s.sendReaction);
  const replyingTo = useChatStore((s) => s.replyingTo);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MessageView[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lastReadRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // ---- Resolve Chat.id ----
  const { data: chatsData } = useQuery({
    queryKey: ['chats'],
    queryFn: listChats,
  });

  const chatId = useMemo(
    () => chatsData?.items.find((c) => c.exchange_id === exchangeId)?.chat_id,
    [chatsData, exchangeId],
  );

  const chatSummary = useMemo(
    () => chatsData?.items.find((c) => c.exchange_id === exchangeId),
    [chatsData, exchangeId],
  );

  const realtimeMessages = useChatStore(useShallow((s) => s.messages[chatId ?? ''] ?? []));
  const typingState = useChatStore(useShallow((s) => s.typing[chatId ?? ''] ?? {}));

  // ---- Exchange info ----
  const { data: exchange } = useQuery({
    queryKey: ['exchange', exchangeId],
    queryFn: () => getExchange(exchangeId!),
    enabled: !!exchangeId,
  });

  const counterpartName = exchange?.counterpart?.name ?? chatSummary?.counterpart_name ?? 'Sohbet';
  const counterpartId = exchange?.counterpart?.id ?? chatSummary?.counterpart_id;

  // Shadow block: reload the local block list when this screen regains focus
  // (e.g. after returning from the chat info screen where the user may have
  // toggled a shadow block).
  useFocusEffect(
    useCallback(() => {
      reloadShadowBlocked();
    }, [reloadShadowBlocked]),
  );

  // Don't reveal a shadow-blocked counterpart's typing — their messages are
  // hidden, so a "yazıyor..." indicator would leak the shadow block.
  const isOtherTyping =
    counterpartId && !isBlocked(counterpartId) && typingState[counterpartId];

  // ---- My books (for book sharing picker) ----
  const { data: myBooksData, isLoading: isLoadingBooks } = useQuery({
    queryKey: ['my-books-picker'],
    queryFn: () => listMyBooks({ limit: 100 }),
    enabled: showBookPicker,
  });
  const myBooks = myBooksData?.items ?? [];

  // ---- Messages ----
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['chat-messages', exchangeId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => getMessages(exchangeId!, pageParam),
    getNextPageParam: (lastPage: MessageListResponse) => lastPage.next_cursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!exchangeId,
  });

  // Merge paginated + real-time, oldest → newest. Shadow-blocked users'
  // messages are silently filtered out here — they still deliver (no error on
  // their side) but are never shown to the blocker. No "X messages hidden"
  // indicator is surfaced, to keep the shadow block undetectable.
  const rawMessages = useMemo(() => {
    const pages = data?.pages ?? [];
    const msgs = pages.flatMap((p: MessageListResponse) => p.items).reverse();
    const existingIds = new Set(msgs.map((m: MessageView) => m.id));
    for (const rm of realtimeMessages) {
      if (!existingIds.has(rm.id)) {
        msgs.push(rm);
      }
    }
    if (shadowBlocked.length > 0) {
      const blocked = new Set(shadowBlocked);
      return msgs.filter((m) => !m.sender_id || !blocked.has(m.sender_id));
    }
    return msgs;
  }, [data, realtimeMessages, shadowBlocked]);

  // Build flat list with date separators + typing indicator
  const listData: MessageListItem[] = useMemo(() => {
    const items: MessageListItem[] = [];
    let lastDate: string | null = null;
    for (const msg of rawMessages) {
      if (!lastDate || !isSameDay(lastDate, msg.created_at)) {
        const label = formatDateLabel(msg.created_at);
        items.push({ type: 'date', date: label, key: `date-${label}` });
        lastDate = msg.created_at;
      }
      items.push({ type: 'message', message: msg, key: msg.id });
    }
    // Typing indicator at the end
    if (isOtherTyping) {
      items.push({ type: 'typing', key: 'typing-indicator' });
    }
    return items;
  }, [rawMessages, isOtherTyping]);

  // ---- Smart reply suggestions ----
  const suggestions = useMemo<string[]>(() => {
    if (inputText.trim().length > 0) return [];
    const lastIncoming = [...rawMessages]
      .reverse()
      .find((m) => m.sender_id !== currentUserId);
    if (!lastIncoming) return ['Tamam', 'Ne zaman?', 'Nerede?'];
    const text = (lastIncoming.text ?? '').toLocaleLowerCase('tr');
    const has = (...keys: string[]) => keys.some((k) => text.includes(k));
    if (has('saat', 'vakit', 'zaman')) return ['14:00 olur', 'Hangi saat?'];
    if (has('nerede', 'yer', 'nerde')) return ['Sen nerede istersin?', "Kafe'de buluşalım"];
    if (text.includes('?')) return ['Evet', 'Hayır', 'Tabi'];
    return ['Tamam', 'Ne zaman?', 'Nerede?'];
  }, [rawMessages, currentUserId, inputText]);

  // ---- Mark as read ----
  useEffect(() => {
    if (!exchangeId || rawMessages.length === 0) return;
    const latest = rawMessages[rawMessages.length - 1];
    if (latest && latest.sender_id !== currentUserId && latest.id !== lastReadRef.current) {
      lastReadRef.current = latest.id;
      markMessagesRead(exchangeId, latest.id).catch(() => {});
    }
  }, [rawMessages.length, exchangeId, currentUserId]);

  // ---- Scroll helpers ----
  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  useEffect(() => {
    if (rawMessages.length > 0) scrollToBottom();
  }, [realtimeMessages.length, isOtherTyping]);

  // ---- Typing indicator ----
  const handleInputChange = (text: string) => {
    setInputText(text);
    if (chatId) {
      sendTyping(chatId, true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(chatId, false);
      }, 2000);
    }
  };

  // ---- Send ----
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !chatId || isSending) return;

    setIsSending(true);
    setInputText('');
    setShowEmojiPicker(false);

    const replyToId = replyingTo?.id ?? null;
    sendMessage(chatId, text, replyToId);

    scrollToBottom(true);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', exchangeId] });
      setIsSending(false);
    }, 500);
  };

  // ---- Send book card ----
  const handleSendBook = (book: BookListResponse['items'][number]) => {
    if (!chatId) return;
    const coverUrl = book.photos?.[0]?.thumbnail_url ?? book.photos?.[0]?.url ?? undefined;
    sendMessage(chatId, '', null, 'book_card', {
      book_id: book.id,
      title: book.title,
      author: book.author ?? undefined,
      cover_url: coverUrl,
      category: book.category,
    });
    setShowBookPicker(false);
    setShowEmojiPicker(false);
    scrollToBottom(true);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', exchangeId] });
    }, 500);
  };

  // ---- Search ----
  const handleSearch = async () => {
    if (!searchQuery.trim() || !exchangeId) return;
    setIsSearching(true);
    try {
      const result = await searchMessages(exchangeId, searchQuery);
      setSearchResults(result.items.map((r) => r.message));
    } catch {
      setSearchResults([]);
    }
    setIsSearching(false);
  };

  const clearSearch = () => {
    setIsSearchMode(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // ---- Message actions ----
  const handleReply = (msg: MessageView) => {
    setReplyingTo(msg);
    inputRef.current?.focus();
  };

  const handleDelete = (msg: MessageView) => {
    if (chatId) {
      sendDelete(chatId, msg.id);
    }
  };

  const handleReaction = (msg: MessageView, emoji: string, action: 'add' | 'remove') => {
    if (chatId) {
      sendReaction(chatId, msg.id, emoji, action);
    }
  };

  // ---- Render ----
  const renderListItem = ({ item }: { item: MessageListItem }) => {
    if (item.type === 'date') {
      return (
        <View style={styles.dateSeparator}>
          <View style={[styles.datePill, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.dateText, { color: colors.textMuted }]}>{item.date}</Text>
          </View>
        </View>
      );
    }

    if (item.type === 'typing') {
      return <TypingIndicator name={counterpartName} />;
    }

    const msg = item.message;
    const isMine = msg.sender_id === currentUserId;

    // Check if this message is grouped with the previous one
    const msgIndex = rawMessages.findIndex((m) => m.id === msg.id);
    const prevMsg = msgIndex > 0 ? rawMessages[msgIndex - 1] : null;
    const isGrouped = prevMsg
      ? prevMsg.sender_id === msg.sender_id && isSameDay(prevMsg.created_at, msg.created_at)
      : false;

    return (
      <MessageBubble
        message={msg}
        isMine={isMine}
        isGrouped={isGrouped}
        currentUserId={currentUserId ?? ''}
        onReply={handleReply}
        onDelete={handleDelete}
        onReaction={handleReaction}
      />
    );
  };

  // Exchange info banner
  const exchangeBook = exchange?.book;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ---- Header ---- */}
      <View style={[styles.header, { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xs, ...shadows.card }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Avatar name={counterpartName} size="small" />
          <View style={{ marginLeft: spacing.sm, flex: 1 }}>
            <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
              {counterpartName}
            </Text>
            {exchangeBook && (
              <Text style={[styles.headerSub, { color: colors.textMuted }]} numberOfLines={1}>
                📖 {exchangeBook.title}
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => {
            if (isSearchMode) {
              clearSearch();
            } else {
              setIsSearchMode(true);
            }
          }}
          testID="chat-search-toggle"
          accessibilityRole="button"
          accessibilityLabel={isSearchMode ? 'Aramayı kapat' : 'Ara'}
        >
          <Ionicons name={isSearchMode ? 'close' : 'search'} size={22} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => router.push(`/chat/info/${exchangeId}`)}
          testID="chat-info-button"
          accessibilityRole="button"
          accessibilityLabel="Sohbet bilgileri"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ---- Search bar (when active) ---- */}
      {isSearchMode && (
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: spacing.xs }} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Sohbette ara..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ---- Exchange context banner ---- */}
      {exchange && !isSearchMode && (
        <View style={[styles.contextBanner, { backgroundColor: colors.primarySoft, borderColor: colors.primary + '30' }]}>
          <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
          <Text style={[styles.contextText, { color: colors.primary }]} numberOfLines={1}>
            Takas: {exchange.book?.title ?? '—'}
          </Text>
        </View>
      )}

      {/* ---- Search results ---- */}
      {isSearchMode && searchResults.length > 0 && (
        <View style={[styles.searchResults, { backgroundColor: colors.surface }]}>
          <Text style={[styles.searchResultsTitle, { color: colors.textMuted }]}>
            {searchResults.length} sonuç bulundu
          </Text>
          {searchResults.slice(0, 10).map((msg) => (
            <TouchableOpacity
              key={msg.id}
              testID={`search-result-${msg.id}`}
              style={[styles.searchResultItem, { borderBottomColor: colors.border }]}
              onPress={() => {
                // Find the message in the flattened list and scroll to it
                const flat = isSearchMode ? listData : listData;
                const index = flat.findIndex((item) => item.key === msg.id);
                if (index >= 0 && flatListRef.current) {
                  try {
                    flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                  } catch {
                    // index out of range (message not in loaded pages) — ignore
                  }
                }
                clearSearch();
              }}
              accessibilityRole="button"
              accessibilityLabel="Arama sonucuna git"
            >
              <Text style={[styles.searchResultText, { color: colors.text }]} numberOfLines={2}>
                {msg.text}
              </Text>
              <Text style={[styles.searchResultTime, { color: colors.textMuted }]}>
                {formatTime(msg.created_at)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ---- Messages ---- */}
      <FlatList
        ref={flatListRef}
        data={isSearchMode ? [] : listData}
        keyExtractor={(item) => item.key}
        renderItem={renderListItem}
        contentContainerStyle={[styles.messagesContainer, { paddingBottom: spacing.md }]}
        onEndReached={() => hasNextPage && fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ padding: spacing.md }} />
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: spacing.md }}>
              <Skeleton variant="list-item" />
              <Skeleton variant="list-item" />
              <Skeleton variant="list-item" />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="chatbubble-ellipses" size={40} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Sohbete Başlayın</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                {counterpartName} ile mesajlaşarak takas detaylarını konuşun
              </Text>
            </View>
          )
        }
      />

      {/* ---- Reply preview bar ---- */}
      {replyingTo && (
        <View style={[styles.replyBar, { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.primary }]}>
          <View style={styles.replyBarContent}>
            <Text style={[styles.replyBarName, { color: colors.primary }]} numberOfLines={1}>
              {replyingTo.sender_id === currentUserId ? 'Sen' : counterpartName}
            </Text>
            <Text style={[styles.replyBarText, { color: colors.textMuted }]} numberOfLines={1}>
              {replyingTo.text}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.replyBarClose} accessibilityRole="button" accessibilityLabel="Yanıttan vazgeç">
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Smart reply chips ---- */}
      {suggestions.length > 0 && (
        <View style={[styles.chipsRow, { backgroundColor: colors.surface }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                onPress={() => {
                  setInputText(s);
                  inputRef.current?.focus();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Öneri: ${s}`}
                testID={`suggestion-chip-${s}`}
              >
                <Text style={[styles.chipText, { color: colors.text }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ---- Input bar ---- */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + spacing.sm,
            ...shadows.sheet,
          },
        ]}
      >
        {/* Emoji button */}
        <TouchableOpacity
          style={[styles.inputAction, { backgroundColor: colors.surfaceAlt }]}
          onPress={() => setShowEmojiPicker(true)}
          accessibilityRole="button"
          accessibilityLabel="Emoji seç"
        >
          <Ionicons name="happy-outline" size={24} color={colors.primary} />
        </TouchableOpacity>

        {/* Book share button */}
        <TouchableOpacity
          style={[styles.inputAction, { backgroundColor: colors.surfaceAlt }]}
          onPress={() => setShowBookPicker(true)}
          accessibilityRole="button"
          accessibilityLabel="Kitap paylaş"
          testID="chat-book-share"
        >
          <Ionicons name="book-outline" size={22} color={colors.primary} />
        </TouchableOpacity>

        {/* Text input */}
        <View style={[styles.inputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            testID="chat-input"
            style={[styles.textInput, { color: colors.text }]}
            placeholder="Mesaj yaz..."
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={handleInputChange}
            multiline
            maxLength={2000}
          />
        </View>

        {/* Send / Voice button */}
        {inputText.trim() ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSend}
            disabled={!chatId || isSending}
            testID="send-button"
            accessibilityRole="button"
            accessibilityLabel="Gönder"
          >
            <LinearGradient
              colors={[colors.primary, isDark ? '#2EA88A' : '#0D5E4F']}
              style={styles.sendBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="send" size={18} color="#ffffff" />
            </LinearGradient>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ---- Emoji picker ---- */}
      <EmojiPicker
        visible={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onSelect={(emoji) => {
          setInputText((prev) => prev + emoji);
          setShowEmojiPicker(false);
        }}
      />

      {/* ---- Book picker ---- */}
      <Modal visible={showBookPicker} transparent animationType="slide" onRequestClose={() => setShowBookPicker(false)}>
        <TouchableOpacity style={styles.bookPickerOverlay} activeOpacity={1} onPress={() => setShowBookPicker(false)}>
          <View
            style={[styles.bookPickerContainer, { backgroundColor: colors.surface, ...shadows.sheet }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.bookPickerTitle, { color: colors.text }]}>Kitap Paylaş</Text>

            {isLoadingBooks ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ padding: spacing.md }} />
            ) : myBooks.length === 0 ? (
              <View style={styles.bookPickerEmpty}>
                <Ionicons name="book-outline" size={36} color={colors.textMuted} />
                <Text style={[styles.bookPickerEmptyText, { color: colors.textMuted }]}>
                  Paylaşabileceğiniz kitap yok
                </Text>
              </View>
            ) : (
              <FlatList
                data={myBooks}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.bookPickerList}
                renderItem={({ item }) => {
                  const coverUrl = item.photos?.[0]?.thumbnail_url ?? item.photos?.[0]?.url ?? null;
                  return (
                    <TouchableOpacity
                      style={[styles.bookPickerItem, { borderBottomColor: colors.border }]}
                      onPress={() => handleSendBook(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Paylaş: ${item.title}`}
                      testID={`book-picker-item-${item.id}`}
                    >
                      <BookCover url={coverUrl} size={40} />
                      <View style={styles.bookPickerInfo}>
                        <Text style={[styles.bookPickerBookTitle, { color: colors.text }]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.author && (
                          <Text style={[styles.bookPickerAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                            {item.author}
                          </Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
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
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  backBtn: {
    padding: spacing.xs,
    marginRight: spacing.xs,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerName: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  headerAction: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.body,
    padding: 0,
  },
  searchResults: {
    maxHeight: 200,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchResultsTitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchResultText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    marginRight: spacing.sm,
  },
  searchResultTime: {
    fontSize: fontSize.caption,
  },
  // Exchange context
  contextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
  },
  contextText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    flex: 1,
  },
  // Messages
  messagesContainer: {
    paddingTop: spacing.sm,
    flexGrow: 1,
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  datePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  dateText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: fontSize.bodySm,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  // Reply bar
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderLeftWidth: 3,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    borderRadius: radius.input,
  },
  replyBarContent: {
    flex: 1,
  },
  replyBarName: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  replyBarText: {
    fontSize: fontSize.bodySm,
    lineHeight: 18,
  },
  replyBarClose: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  // Smart reply chips
  chipsRow: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  chipsContent: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
    gap: spacing.xs,
  },
  inputAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    borderRadius: radius.button,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: fontSize.body,
    lineHeight: 20,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? spacing.xs : spacing.sm,
    margin: 0,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  sendBtnGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.float,
  },
  // Book picker sheet
  bookPickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  bookPickerContainer: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '60%',
    paddingBottom: 34,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  bookPickerTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  bookPickerEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: spacing.sm,
  },
  bookPickerEmptyText: {
    fontSize: fontSize.bodySm,
  },
  bookPickerList: {
    paddingHorizontal: spacing.md,
  },
  bookPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookPickerInfo: {
    flex: 1,
    gap: 2,
  },
  bookPickerBookTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  bookPickerAuthor: {
    fontSize: fontSize.caption,
  },
});
