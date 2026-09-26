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
  ScrollView,
  Modal,
  Alert,
  Linking,
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
import { MapView, Marker } from '@/lib/map-adapter';
import { BookCover } from '@/components/ui/book-cover';
import { SafetyPermissionError, hasSentAnyLocationFix, getLastSentLocation } from '@/lib/safety';
import { useNerdeyimMode } from '@/hooks/use-nerdeyim-mode';
import { useCallStore } from '@/stores/call-store';
import { isCallSupported } from '@/lib/webrtc';
import { useLocationSharingStore } from '@/stores/location-sharing-store';

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
  const currentUserName = useAuthStore((s) => s.user?.name);
  const { shadowBlocked, isBlocked, reload: reloadShadowBlocked } = useShadowBlocked();
  const connect = useChatStore((s) => s.connect);
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
  const [, setIsSearching] = useState(false);
  const [liveMapExpanded, setLiveMapExpanded] = useState(false);
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
  const presence = useChatStore(useShallow((s) => s.presence));
  const startCall = useCallStore((s) => s.startCall);
  const callStatus = useCallStore((s) => s.status);

  // ---- Exchange info ----
  const { data: exchange } = useQuery({
    queryKey: ['exchange', exchangeId],
    queryFn: () => getExchange(exchangeId!),
    enabled: !!exchangeId,
  });

  const counterpartName = exchange?.counterpart?.name ?? chatSummary?.counterpart_name ?? 'Sohbet';
  const counterpartId = exchange?.counterpart?.id ?? chatSummary?.counterpart_id;
  const counterpartAvatarUrl = (exchange?.counterpart as any)?.avatar_url ?? chatSummary?.counterpart_avatar_url ?? undefined;

  // Ensure WebSocket is connected whenever this screen is focused.
  // Without this, navigating from the chats tab (which connects WS on focus
  // and disconnects on blur) to this Stack screen leaves WS disconnected,
  // making sendMessage() fail silently with "Bağlantı yok".
  // Guard in store::connect() prevents duplicate subscriptions.
  // Shadow block reload keeps the local block list current (e.g. after
  // toggling shadow block in chat info screen).
  useFocusEffect(
    useCallback(() => {
      connect();
      reloadShadowBlocked();
    }, [connect, reloadShadowBlocked]),
  );

  // ---- Nerdeyim Modu (live location sharing) — single shared hook, see
  // hooks/use-nerdeyim-mode.ts + stores/location-sharing-store.ts for why
  // this replaced a local, screen-only implementation.
  const isMeetupConfirmed = exchange?.status === 'meetup_confirmed';
  const { isSharing: myLocationSharing, partnerSharing, partnerLocation, start: startNerdeyim } = useNerdeyimMode(
    exchangeId,
    isMeetupConfirmed,
  );
  // My own last-sent fix — shown as a second labeled pin so BOTH parties are
  // visible on the live map. Read at render; re-renders arrive with every
  // status poll / WS push, which tracks the 30s heartbeat closely enough.
  const myLiveLocation = myLocationSharing ? getLastSentLocation() : null;

  // Region for the live map: fit partner pin + my pin + (if any) the meetup
  // point in one frame, with sane zoom bounds.
  const liveMapRegion = useMemo(() => {
    if (!partnerLocation) return null;
    const lats = [partnerLocation.latitude];
    const lngs = [partnerLocation.longitude];
    if (myLiveLocation) {
      lats.push(myLiveLocation.latitude);
      lngs.push(myLiveLocation.longitude);
    }
    if (exchange?.meetup?.lat != null && exchange?.meetup?.lng != null) {
      lats.push(exchange.meetup.lat);
      lngs.push(exchange.meetup.lng);
    }
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 2.6, 0.012),
      longitudeDelta: Math.max((maxLng - minLng) * 2.6, 0.012),
    };
  }, [
    partnerLocation,
    myLiveLocation,
    exchange?.meetup?.lat,
    exchange?.meetup?.lng,
  ]);

  // Permission being granted doesn't mean the device ever produces an actual
  // fix — no last-known cache, no GPS/network lock, nothing. That failure
  // was completely silent before (a console.warn only): the UI would show
  // "sharing active" while zero coordinates ever reached the backend, so the
  // partner's map/banner never populated. Give it a few seconds to land the
  // first fix, then warn if nothing arrived.
  const warnIfNoLocationFix = useCallback(() => {
    setTimeout(() => {
      if (!hasSentAnyLocationFix()) {
        Alert.alert(
          'Konum Gönderilemiyor',
          'Konum paylaşımı başladı ama cihazından hiç konum alınamadı. Lütfen konum servislerinin (GPS) açık olduğundan emin ol.',
        );
      }
    }, 8000);
  }, []);

  const handleReciprocateLocation = useCallback(async () => {
    if (!exchangeId) return;
    const meetupTime = exchange?.meetup?.scheduled_at
      ? new Date(exchange.meetup.scheduled_at)
      : new Date();
    try {
      await startNerdeyim(meetupTime);
      warnIfNoLocationFix();
      if (chatId) {
        sendMessage(chatId, 'Canlı konum paylaşımı başlattı', null, 'location_invite', {
          exchange_id: exchangeId,
        });
      }
    } catch (error) {
      if (error instanceof SafetyPermissionError) {
        Alert.alert('Arka Plan Konum İzni Gerekli', error.message, [
          { text: 'İptal', style: 'cancel' },
          { text: 'Ayarlara Git', onPress: () => Linking.openSettings() },
        ]);
      } else {
        Alert.alert('Konum Paylaşılamadı', 'Konum paylaşımı başlatılamadı. Lütfen tekrar deneyin.');
      }
    }
  }, [exchangeId, exchange?.meetup?.scheduled_at, chatId, warnIfNoLocationFix, startNerdeyim, sendMessage]);

  // ---- Voice / video calls ----
  const counterpartOnline = counterpartId ? presence[counterpartId]?.is_online ?? false : false;
  const callsAvailable = isCallSupported();

  const handleStartCall = useCallback(
    async (kind: 'audio' | 'video') => {
      if (!chatId || callStatus !== 'idle') return;
      if (counterpartId && isBlocked(counterpartId)) return;
      const ok = await startCall(chatId, kind, {
        id: counterpartId,
        name: counterpartName,
        avatarUrl: counterpartAvatarUrl ?? null,
      });
      if (!ok) {
        // startCall başarısız — endReason'a göre spesifik hata göster.
        // Store state'i doğrudan oku (useCallback closure'ına güvenme).
        const reason = useCallStore.getState().endReason;
        switch (reason) {
          case 'permission-denied':
            Alert.alert(
              'Mikrofon İzni Gerekli',
              'Arama yapabilmek için mikrofon izni gerekiyor. Lütfen Ayarlar > Uygulamalar > MeetBook > İzinler bölümünden mikrofon iznini aç.',
              [
                { text: 'İptal', style: 'cancel' },
                { text: 'Ayarlara Git', onPress: () => { try { Linking.openSettings(); } catch {} } },
              ],
            );
            break;
          case 'permission-blocked':
            Alert.alert(
              'İzin Kalıcı Olarak Reddedildi',
              'Mikrofon izni kalıcı olarak reddedilmiş. Arama yapabilmek için Ayarlar > Uygulamalar > MeetBook > İzinler bölümünden mikrofon iznini açmalısın.',
              [
                { text: 'İptal', style: 'cancel' },
                { text: 'Ayarlara Git', onPress: () => { try { Linking.openSettings(); } catch {} } },
              ],
            );
            break;
          case 'failed':
            Alert.alert(
              'Arama Başlatılamadı',
              'Arama başlatılamadı. Bağlantını ve mikrofon/kamera izinlerini kontrol edip tekrar dene.',
            );
            break;
          default:
            Alert.alert(
              'Arama Başlatılamadı',
              'Arama başlatılamadı. Lütfen tekrar dene.',
            );
        }
      }
    },
    [chatId, callStatus, counterpartId, counterpartName, counterpartAvatarUrl, startCall, isBlocked],
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
  }, [rawMessages, exchangeId, currentUserId]);

  // ---- Scroll helpers ----
  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  useEffect(() => {
    if (rawMessages.length > 0) scrollToBottom();
    // Intentionally keyed on realtimeMessages.length: rawMessages.length also grows
    // when older history pages load, and auto-scrolling then would yank the reader away.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll on new realtime messages only
  }, [realtimeMessages.length, isOtherTyping]);

  // ---- Typing indicator ----
  // Throttled: "typing" goes out at most every 2.5s instead of on every
  // keystroke (the old behavior spammed one WS frame per character).
  const lastTypingSentRef = useRef(0);
  const handleInputChange = (text: string) => {
    setInputText(text);
    if (chatId) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 2500) {
        lastTypingSentRef.current = now;
        sendTyping(chatId, true);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        lastTypingSentRef.current = 0;
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

  // ---- Nerdeyim Modu invite (live location sharing consent) ----
  const handleSendLocationInvite = () => {
    if (!chatId || !exchangeId) return;
    sendMessage(chatId, 'Canlı konum paylaşımı teklif etti', null, 'location_invite', {
      exchange_id: exchangeId,
    });
    // Sender starts sharing right away — once the other side accepts, both
    // markers show up live without a second round trip.
    const meetupTime = exchange?.meetup?.scheduled_at
      ? new Date(exchange.meetup.scheduled_at)
      : new Date();
    startNerdeyim(meetupTime).catch(() => {});
    warnIfNoLocationFix();
    scrollToBottom(true);
  };

  const handleAcceptLocationInvite = async (msg: MessageView) => {
    const targetExchangeId = msg.extra?.exchange_id ?? exchangeId;
    if (!targetExchangeId) return;
    const meetupTime = exchange?.meetup?.scheduled_at
      ? new Date(exchange.meetup.scheduled_at)
      : new Date();
    try {
      await useLocationSharingStore.getState().start(targetExchangeId, meetupTime);
      warnIfNoLocationFix();
      if (chatId) {
        // Announce the ACCEPTER's own action — this was previously using
        // `counterpartName` (the other party's name), so the system message
        // read backwards: "Can Manici accepted" would show up on Arif's own
        // accept action. Both sides then saw messages attributing acceptance
        // to the wrong person, which reads exactly like an infinite
        // back-and-forth loop even though the invite had already resolved.
        sendMessage(
          chatId,
          'Canlı konum paylaşımını kabul etti',
          null,
          'system',
          { action: 'location_accepted' },
        );
      }
    } catch (error) {
      if (error instanceof SafetyPermissionError) {
        Alert.alert('Arka Plan Konum İzni Gerekli', error.message, [
          { text: 'İptal', style: 'cancel' },
          { text: 'Ayarlara Git', onPress: () => Linking.openSettings() },
        ]);
      } else {
        Alert.alert('Konum Paylaşılamadı', 'Konum paylaşımı başlatılamadı. Lütfen tekrar deneyin.');
      }
      throw error;
    }
  };

  const handleDeclineLocationInvite = (_msg: MessageView) => {
    // No backend state — declining just leaves the sender's share running
    // until it naturally times out; the bubble reflects the decline locally.
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

    // Call history entries render as their own centered bubble, tappable to
    // call back with the same kind (audio/video).
    if (msg.extra?.action === 'call_log') {
      const callKind = (msg.extra as any).kind === 'video' ? 'video' : 'audio';
      const callState = (msg.extra as any).status as string;
      const duration = Number((msg.extra as any).duration_seconds ?? 0);
      const missed = callState === 'missed' || callState === 'rejected' || callState === 'failed';
      const durationLabel =
        callState === 'ended' && duration > 0
          ? ` · ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
          : '';
      const label =
        callState === 'missed' ? (isMine ? 'Cevapsız arama' : 'Cevapsız arama')
        : callState === 'rejected' ? 'Reddedilen arama'
        : callState === 'failed' ? 'Arama bağlanamadı'
        : callKind === 'video' ? `Görüntülü arama${durationLabel}`
        : `Sesli arama${durationLabel}`;
      return (
        <TouchableOpacity
          style={styles.callLogRow}
          onPress={() => callsAvailable && handleStartCall(callKind)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${label} — tekrar ara`}
        >
          <View style={[styles.callLogPill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <View style={[styles.callLogIcon, { backgroundColor: missed ? '#E5484D20' : colors.primarySoft }]}>
              <Ionicons
                name={callKind === 'video' ? (missed ? 'videocam-off' : 'videocam') : 'call'}
                size={15}
                color={missed ? '#E5484D' : colors.primary}
              />
            </View>
            <Text style={[styles.callLogText, { color: missed ? '#E5484D' : colors.text }]}>{label}</Text>
            <Text style={[styles.callLogTime, { color: colors.textMuted }]}>{formatTime(msg.created_at)}</Text>
          </View>
        </TouchableOpacity>
      );
    }

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
        counterpartAvatarUrl={counterpartAvatarUrl}
        onReply={handleReply}
        onDelete={handleDelete}
        onReaction={handleReaction}
        onAcceptLocationInvite={handleAcceptLocationInvite}
        onDeclineLocationInvite={handleDeclineLocationInvite}
      />
    );
  };

  // Exchange info banner
  const exchangeBook = exchange?.book;

  // Shared marker set for the inline live-map card and the fullscreen modal:
  // labeled partner avatar pin + (if scheduled) the meetup point flag.
  const renderLiveMapMarkers = () => {
    if (!partnerLocation) return null;
    return (
      <>
        {exchange?.meetup?.lat != null && exchange?.meetup?.lng != null && (
          <Marker
            coordinate={{ latitude: exchange.meetup.lat, longitude: exchange.meetup.lng }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.markerColumn}>
              <View style={[styles.partnerMarkerName, { backgroundColor: colors.surface, ...shadows.card }]}>
                <Text style={[styles.partnerMarkerNameText, { color: colors.text }]} numberOfLines={1}>
                  Buluşma
                </Text>
              </View>
              <View style={[styles.meetupMarkerBubble, { backgroundColor: colors.primary }]}>
                <Ionicons name="flag" size={13} color="#ffffff" />
              </View>
              <View style={[styles.markerStem, { borderTopColor: colors.primary }]} />
            </View>
          </Marker>
        )}
        {myLiveLocation && (
          <Marker
            coordinate={{ latitude: myLiveLocation.latitude, longitude: myLiveLocation.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            testID="chat-my-location-marker"
          >
            <View style={styles.markerColumn}>
              <View style={[styles.partnerMarkerName, { backgroundColor: colors.primary, ...shadows.card }]}>
                <Text style={[styles.partnerMarkerNameText, { color: '#ffffff' }]} numberOfLines={1}>
                  Sen
                </Text>
              </View>
              <View style={[styles.partnerMarkerBubble, { borderColor: colors.primary }]}>
                <Avatar name={currentUserName ?? 'Sen'} size="small" />
              </View>
              <View style={[styles.markerStem, { borderTopColor: colors.primary }]} />
            </View>
          </Marker>
        )}
        <Marker
          coordinate={{ latitude: partnerLocation.latitude, longitude: partnerLocation.longitude }}
          anchor={{ x: 0.5, y: 1 }}
          testID="chat-partner-location-marker"
        >
          <View style={styles.markerColumn}>
            <View style={[styles.partnerMarkerName, { backgroundColor: colors.surface, ...shadows.card }]}>
              <Text style={[styles.partnerMarkerNameText, { color: colors.text }]} numberOfLines={1}>
                {counterpartName}
              </Text>
            </View>
            <View style={styles.partnerMarkerBubble}>
              <Avatar name={counterpartName} imageUrl={counterpartAvatarUrl} size="small" />
            </View>
            <View style={[styles.markerStem, { borderTopColor: '#34C759' }]} />
          </View>
        </Marker>
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* ---- Header ---- */}
      <View style={[styles.header, { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xs, ...shadows.card }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Avatar name={counterpartName} imageUrl={counterpartAvatarUrl} size="small" />
          <View style={{ marginLeft: spacing.sm, flex: 1 }}>
            <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
              {counterpartName}
            </Text>
            {counterpartOnline ? (
              <View style={styles.presenceRow}>
                <View style={styles.onlineDot} />
                <Text style={[styles.headerSub, { color: colors.success }]} numberOfLines={1}>
                  çevrimiçi
                </Text>
              </View>
            ) : exchangeBook ? (
              <Text style={[styles.headerSub, { color: colors.textMuted }]} numberOfLines={1}>
                📖 {exchangeBook.title}
              </Text>
            ) : null}
          </View>
        </View>

        {callsAvailable && (
          <>
            <TouchableOpacity
              style={styles.headerAction}
              onPress={() => handleStartCall('audio')}
              disabled={!chatId || callStatus !== 'idle'}
              testID="chat-voice-call"
              accessibilityRole="button"
              accessibilityLabel="Sesli arama"
            >
              <Ionicons name="call-outline" size={22} color={chatId ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerAction}
              onPress={() => handleStartCall('video')}
              disabled={!chatId || callStatus !== 'idle'}
              testID="chat-video-call"
              accessibilityRole="button"
              accessibilityLabel="Görüntülü arama"
            >
              <Ionicons name="videocam-outline" size={24} color={chatId ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
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

      {/* ---- Nerdeyim Modu reciprocation banner ---- */}
      {!isSearchMode && !myLocationSharing && partnerSharing && (
        <View style={[styles.locationBanner, { backgroundColor: colors.success + '15', borderColor: colors.success + '30' }]}>
          <Ionicons name="locate" size={16} color={colors.success} />
          <Text style={[styles.locationBannerText, { color: colors.text }]} numberOfLines={1}>
            {counterpartName} canlı konumunu paylaşıyor
          </Text>
          <TouchableOpacity
            style={[styles.locationBannerButton, { backgroundColor: colors.success }]}
            onPress={handleReciprocateLocation}
            testID="chat-location-reciprocate-button"
          >
            <Text style={styles.locationBannerButtonText}>Sen de Paylaş</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Nerdeyim Modu: both sides sharing — live map embedded in the DM ---- */}
      {!isSearchMode && myLocationSharing && partnerLocation && liveMapRegion && (
        <View style={[styles.locationMapCard, { backgroundColor: colors.surface, borderColor: colors.success + '30', ...shadows.card }]}>
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => setLiveMapExpanded(true)}
            testID="chat-location-map"
            accessibilityRole="button"
            accessibilityLabel="Canlı konum haritasını büyüt"
          >
            {/* Fixed-height wrapper is required: the map adapter applies
                flex:1 (flexBasis:0%) to every MapView, which overrides an
                explicit height in an auto-height parent and collapses the
                map to 0px. Bounding it from outside sidesteps that. */}
            <View style={styles.locationMap} pointerEvents="none">
              <MapView style={{ flex: 1 }} region={liveMapRegion}>
                {renderLiveMapMarkers()}
              </MapView>
            </View>

            {/* CANLI badge */}
            <View style={styles.liveBadge}>
              <View style={styles.liveBadgeDot} />
              <Text style={styles.liveBadgeText}>CANLI</Text>
            </View>

            {/* expand hint */}
            <View style={styles.expandHint}>
              <Ionicons name="expand-outline" size={14} color="#ffffff" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.locationMapFooter}
            onPress={() => setLiveMapExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel="Canlı konum detayları"
          >
            <Avatar name={counterpartName} imageUrl={counterpartAvatarUrl} size="small" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.locationMapFooterText, { color: colors.text }]} numberOfLines={1}>
                {counterpartName} canlı konumunu paylaşıyor
              </Text>
              {partnerLocation.updated_at ? (
                <Text style={[styles.locationMapFooterSub, { color: colors.textMuted }]}>
                  Son güncelleme {formatTime(partnerLocation.updated_at)}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Nerdeyim Modu: I'm sharing, no partner pin yet ---- */}
      {!isSearchMode && myLocationSharing && !partnerLocation && (
        <View style={[styles.locationBanner, { backgroundColor: colors.info + '15', borderColor: colors.info + '30' }]}>
          <Ionicons name="time-outline" size={16} color={colors.info} />
          <Text style={[styles.locationBannerText, { color: colors.text }]} numberOfLines={1}>
            {partnerSharing
              ? `Paylaşım aktif — ${counterpartName} konumu alınıyor…`
              : `Canlı konum paylaşımı aktif — ${counterpartName} bekleniyor…`}
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

        {/* Nerdeyim Modu invite button — only once a meetup is confirmed */}
        {exchange?.status === 'meetup_confirmed' && (
          <TouchableOpacity
            style={[styles.inputAction, { backgroundColor: colors.surfaceAlt }]}
            onPress={handleSendLocationInvite}
            accessibilityRole="button"
            accessibilityLabel="Canlı konum paylaş"
            testID="chat-location-invite"
          >
            <Ionicons name="navigate-outline" size={22} color={colors.info} />
          </TouchableOpacity>
        )}

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
            style={[styles.bookPickerContainer, { backgroundColor: colors.surface, paddingBottom: Math.max(20, insets.bottom), ...shadows.sheet }]}
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

      {/* ---- Fullscreen live location map ---- */}
      <Modal
        visible={liveMapExpanded}
        animationType="slide"
        onRequestClose={() => setLiveMapExpanded(false)}
      >
        <View style={[styles.liveMapModal, { backgroundColor: colors.background }]}>
          <View
            style={[
              styles.liveMapHeader,
              { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xs, ...shadows.card },
            ]}
          >
            <TouchableOpacity
              onPress={() => setLiveMapExpanded(false)}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Haritayı kapat"
              testID="live-map-close"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.liveMapTitle, { color: colors.text }]}>Canlı Konum</Text>
              <Text style={[styles.liveMapSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {counterpartName}
              </Text>
            </View>
            <View style={[styles.liveBadge, styles.liveBadgeInline]}>
              <View style={styles.liveBadgeDot} />
              <Text style={styles.liveBadgeText}>CANLI</Text>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {liveMapRegion && (
              <MapView style={{ flex: 1 }} region={liveMapRegion} testID="live-map-fullscreen">
                {renderLiveMapMarkers()}
              </MapView>
            )}
          </View>

          <View
            style={[
              styles.liveMapFooter,
              { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md, ...shadows.sheet },
            ]}
          >
            <Avatar name={counterpartName} imageUrl={counterpartAvatarUrl} size="small" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.locationMapFooterText, { color: colors.text }]} numberOfLines={1}>
                {counterpartName} canlı konumunu paylaşıyor
              </Text>
              {partnerLocation?.updated_at ? (
                <Text style={[styles.locationMapFooterSub, { color: colors.textMuted }]}>
                  Son güncelleme {formatTime(partnerLocation.updated_at)}
                  {exchange?.meetup?.place_name ? ` • ${exchange.meetup.place_name}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
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
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  // Call log bubble
  callLogRow: {
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  callLogPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  callLogIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callLogText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  callLogTime: {
    fontSize: fontSize.caption,
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
  locationBanner: {
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
  locationBannerText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    flex: 1,
  },
  locationBannerButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  locationBannerButtonText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: '#ffffff',
  },
  locationMapCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  locationMap: {
    width: '100%',
    height: 160,
  },
  locationMapFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  locationMapFooterText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  locationMapFooterSub: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  // Live badge overlaid on the map
  liveBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E5484D',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  liveBadgeInline: {
    position: 'relative',
    top: 0,
    left: 0,
  },
  liveBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.8,
  },
  expandHint: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Map markers (avatar pin + meetup flag)
  markerColumn: {
    alignItems: 'center',
  },
  partnerMarkerName: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: 4,
    maxWidth: 120,
  },
  partnerMarkerNameText: {
    fontSize: 11,
    fontWeight: '700',
  },
  partnerMarkerBubble: {
    borderWidth: 2,
    borderColor: '#34C759',
    borderRadius: 20,
    padding: 1,
    backgroundColor: '#ffffff',
  },
  meetupMarkerBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  markerStem: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  // Fullscreen live map modal
  liveMapModal: {
    flex: 1,
  },
  liveMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  liveMapTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  liveMapSubtitle: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  liveMapFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
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
