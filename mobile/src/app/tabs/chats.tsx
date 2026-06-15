import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, palette, spacing, fontSize } from '@/components/ui';
import { listChats } from '@/lib/api/chat';
import { useChatStore } from '@/stores/chat-store';
import type { ChatSummary } from '@/lib/api/chat';

export default function ChatsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const connected = useChatStore((s) => s.connected);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['chats'],
    queryFn: listChats,
    refetchInterval: 15000,
  });

  // Connect WebSocket when the screen is focused
  useFocusEffect(
    useCallback(() => {
      connect();
      return () => disconnect();
    }, []),
  );

  const chats = data?.items ?? [];

  const renderItem = ({ item }: { item: ChatSummary }) => (
    <TouchableOpacity
      style={[styles.chatItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
      onPress={() => router.push(`/chat/${item.exchange_id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.avatarContainer}>
        <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {item.counterpart_name.charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <Text
            style={[styles.counterpartName, { color: colors.text }]}
            numberOfLines={1}
          >
            {item.counterpart_name}
          </Text>
          {item.last_message_at && (
            <Text style={[styles.timeText, { color: colors.textMuted }]}>
              {formatTime(item.last_message_at)}
            </Text>
          )}
        </View>

        <View style={styles.messageRow}>
          <Text
            style={[styles.lastMessage, { color: colors.textMuted }]}
            numberOfLines={2}
          >
            {item.last_message ?? 'Henüz mesaj yok'}
          </Text>
          {item.unread_count > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {item.unread_count > 99 ? '99+' : item.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textMuted}
        style={styles.chevron}
      />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Mesajlar
        </Text>
        <View style={styles.statusDotContainer}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? '#22c55e' : '#ef4444' },
            ]}
          />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>
            {connected ? 'Bağlı' : 'Bağlanıyor...'}
          </Text>
        </View>
      </View>

      <FlatList
        data={chats}
        keyExtractor={(item) => item.chat_id}
        renderItem={renderItem}
        contentContainerStyle={chats.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <EmptyState
            message="Henüz sohbet yok"
            description="Bir kitap talebi kabul edildiğinde burada görünür"
            illustration={<Ionicons name="chatbubbles-outline" size={64} color={colors.textMuted} />}
          />
        }
      />
    </View>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Şimdi';
  if (diffMins < 60) return `${diffMins}dk`;
  if (diffHours < 24) return `${diffHours}s`;
  if (diffDays < 7) return `${diffDays}g`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  statusDotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarContainer: {
    marginRight: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  counterpartName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  timeText: {
    fontSize: 12,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: fontSize.caption,
    flex: 1,
    marginRight: spacing.sm,
  },
  unreadBadge: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  chevron: {
    marginLeft: spacing.sm,
  },
});
