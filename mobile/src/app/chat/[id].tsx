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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { palette, spacing, fontSize } from '@/components/ui';
import {
  getMessages,
  listChats,
  markMessagesRead,
  type MessageView,
  type MessageListResponse,
} from '@/lib/api/chat';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { getExchange } from '@/lib/api/client';

export default function ChatDetailScreen() {
  const { id: exchangeId } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const sendMessage = useChatStore((s) => s.sendMessage);

  // Resolve the real Chat.id for this exchange — the WS protocol and
  // real-time message buffer key on Chat.id, not ExchangeRequest.id.
  const { data: chatsData } = useQuery({
    queryKey: ['chats'],
    queryFn: listChats,
  });

  const chatId = useMemo(
    () => chatsData?.items.find((c) => c.exchange_id === exchangeId)?.chat_id,
    [chatsData, exchangeId],
  );

  const realtimeMessages = useChatStore(useShallow((s) => s.messages[chatId ?? ''] ?? []));

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lastReadRef = useRef<string | null>(null);

  // Fetch exchange detail for counterpart name
  const { data: exchange } = useQuery({
    queryKey: ['exchange', exchangeId],
    queryFn: () => getExchange(exchangeId!),
    enabled: !!exchangeId,
  });

  const counterpartName =
    exchange?.counterpart?.name ?? 'Sohbet';

  // Fetch messages — newest first, cursor-paginated
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

  // Flatten pages (oldest → newest)
  const allMessages = useMemo(() => {
    const pages = data?.pages ?? [];
    const msgs = pages.flatMap((p: MessageListResponse) => p.items).reverse();
    // Merge real-time messages
    const existingIds = new Set(msgs.map((m: MessageView) => m.id));
    for (const rm of realtimeMessages) {
      if (!existingIds.has(rm.id)) {
        msgs.push(rm);
      }
    }
    return msgs;
  }, [data, realtimeMessages]);

  // Mark messages as read
  useEffect(() => {
    if (!exchangeId || allMessages.length === 0) return;
    const latest = allMessages[allMessages.length - 1];
    if (latest && latest.sender_id !== currentUserId && latest.id !== lastReadRef.current) {
      lastReadRef.current = latest.id;
      markMessagesRead(exchangeId, latest.id).catch(() => {});
    }
  }, [allMessages.length, exchangeId, currentUserId]);

  // Scroll to bottom on new message
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    if (allMessages.length > 0) scrollToBottom();
  }, [realtimeMessages.length]);

  // Send message
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !chatId || isSending) return;

    setIsSending(true);
    setInputText('');

    // Optimistic local add
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: MessageView = {
      id: tempId,
      chat_id: chatId,
      sender_id: currentUserId ?? '',
      text,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    useChatStore.getState().addMessage(chatId, optimisticMsg);

    // Send via WebSocket
    sendMessage(chatId, text);

    // Refetch after short delay to get confirmed messages
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', exchangeId] });
      setIsSending(false);
    }, 500);
  };

  // Render a single message bubble
  const renderMessage = ({ item }: { item: MessageView }) => {
    const isMine = item.sender_id === currentUserId;
    const isPending = item.id.startsWith('temp-');

    return (
      <View
        style={[
          styles.messageRow,
          isMine ? styles.myMessageRow : styles.otherMessageRow,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isMine
              ? [styles.myBubble, { backgroundColor: colors.primary }]
              : [styles.otherBubble, { backgroundColor: colors.surface }],
            isPending && styles.pendingBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              { color: isMine ? '#ffffff' : colors.text },
            ]}
          >
            {item.text}
          </Text>
          <View style={styles.messageMeta}>
            <Text
              style={[
                styles.timeLabel,
                { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted },
              ]}
            >
              {formatTime(item.created_at)}
            </Text>
            {isMine && (
              <Ionicons
                name={item.read_at ? 'checkmark-done' : 'checkmark'}
                size={14}
                color={item.read_at ? '#60a5fa' : 'rgba(255,255,255,0.5)'}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, paddingTop: insets.top },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {counterpartName}
          </Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={allMessages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesContainer}
        onEndReached={() => hasNextPage && fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ padding: 16 }} />
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 100 }} />
          ) : (
            <View style={styles.emptyMessages}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                Mesaj göndermeye başlayın
              </Text>
            </View>
          )
        }
      />

      {/* Input bar */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + spacing.sm,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder="Mesaj yaz..."
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={2000}
          onSubmitEditing={handleSend}
          blurOnSubmit
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: inputText.trim() ? colors.primary : colors.textMuted + '40',
            },
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || !chatId || isSending}
        >
          <Ionicons name="send" size={20} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'şimdi';
  if (diffMins < 60) return `${diffMins}dk`;

  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.light.border,
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  headerRight: {
    width: 44,
  },
  messagesContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
  },
  messageRow: {
    marginVertical: 3,
    flexDirection: 'row',
  },
  myMessageRow: {
    justifyContent: 'flex-end',
  },
  otherMessageRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  myBubble: {
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    borderBottomLeftRadius: 4,
  },
  pendingBubble: {
    opacity: 0.7,
  },
  messageText: {
    fontSize: fontSize.body,
    lineHeight: 20,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeLabel: {
    fontSize: 11,
  },
  emptyMessages: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: fontSize.body,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.light.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: fontSize.body,
    maxHeight: 100,
    borderWidth: 1,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
