/**
 * NotificationsScreen — in-app notification center (spec: bell icon on home).
 *
 * Lists notifications from GET /notifications. Unread items get a primary
 * left border + soft tint. Tapping a notification marks it read (optimistic)
 * and navigates based on type:
 *   - exchange-like   → /exchange/{exchange_id|id}
 *   - chat-like       → /chat/{chat_id|id}
 *   - book-like       → /book/{book_id|id}
 *   - report/broadcast/admin → no navigation (informational)
 *
 * Backend types currently emitted: geofence_match, report_resolved,
 * admin_broadcast. Payload is a free-form object; we read title/message/body/
 * book_title when present and fall back to type-derived defaults.
 */
import { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';

import { palette, spacing, fontSize, radius, shadows, type ThemeColors } from '@/components/ui/tokens';
import { EmptyState } from '@/components/ui';
import {
  listNotifications,
  markNotificationsRead,
  type NotificationListResponse,
} from '@/lib/api/client';

type NotificationItem = NotificationListResponse['items'][number];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'az önce';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} gün önce`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} hf önce`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(day / 365)} yıl önce`;
}

type NotifKind = 'exchange' | 'chat' | 'book' | 'report' | 'broadcast' | 'none';

function kindFor(type: string): NotifKind {
  const t = type.toLowerCase();
  if (t.includes('exchange') || t.includes('swap') || t.includes('trade')) return 'exchange';
  if (t.includes('chat') || t.includes('message')) return 'chat';
  if (t.includes('geofence') || t.includes('book') || t.includes('wishlist')) return 'book';
  if (t.includes('report')) return 'report';
  if (t.includes('broadcast') || t.includes('admin')) return 'broadcast';
  return 'none';
}

function iconFor(kind: NotifKind): React.ComponentProps<typeof Ionicons>['name'] {
  switch (kind) {
    case 'exchange':
      return 'swap-horizontal';
    case 'chat':
      return 'chatbubble-ellipses';
    case 'book':
      return 'book';
    case 'report':
      return 'flag';
    case 'broadcast':
      return 'megaphone';
    default:
      return 'notifications';
  }
}

function defaultTitle(type: string): string {
  switch (kindFor(type)) {
    case 'book':
      return 'Kitap Eşleşmesi';
    case 'exchange':
      return 'Takas Güncellemesi';
    case 'chat':
      return 'Yeni Mesaj';
    case 'report':
      return 'Şikayetiniz Çözüldü';
    case 'broadcast':
      return 'Duyuru';
    default:
      return 'Bildirim';
  }
}

function defaultBody(type: string, payload: Record<string, unknown>): string {
  switch (kindFor(type)) {
    case 'book':
      return (payload.book_title as string) ?? 'İstek listenizdeki bir kitap yakınında bulundu.';
    case 'exchange':
      return 'Takas talebinizde güncelleme var.';
    case 'chat':
      return 'Yeni bir mesajınız var.';
    case 'report': {
      const status = payload.status ? ` (${String(payload.status)})` : '';
      return `Şikayet durumunuz çözüldü olarak işaretlendi${status}.`;
    }
    case 'broadcast':
      return '';
    default:
      return '';
  }
}

function navTargetFor(item: NotificationItem): string | null {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  switch (kindFor(item.type)) {
    case 'exchange': {
      const id = (p.exchange_id as string) ?? (p.id as string);
      return id ? `/exchange/${id}` : null;
    }
    case 'chat': {
      const id = (p.chat_id as string) ?? (p.id as string);
      return id ? `/chat/${id}` : null;
    }
    case 'book': {
      const id = (p.book_id as string) ?? (p.id as string);
      return id ? `/book/${id}` : null;
    }
    default:
      return null;
  }
}

function textFor(item: NotificationItem): { title: string; body: string } {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const title = (p.title as string) ?? defaultTitle(item.type);
  const body = (p.message as string) ?? (p.body as string) ?? defaultBody(item.type, p);
  return { title, body: body ?? '' };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    staleTime: 30_000,
  });

  const items = useMemo(() => notificationsQuery.data?.items ?? [], [notificationsQuery.data]);

  const handlePress = useCallback(
    async (item: NotificationItem) => {
      const target = navTargetFor(item);

      // Optimistic: flip read_at immediately so the UI feels instant.
      queryClient.setQueryData<NotificationListResponse>(['notifications'], (prev) => {
        if (!prev) return prev;
        return {
          items: prev.items.map((n) =>
            n.id === item.id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
          ),
        };
      });

      try {
        await markNotificationsRead({ notification_ids: [item.id] });
      } catch {
        // Revert on failure — best-effort, don't block navigation.
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }

      if (target) router.push(target as Href);
    },
    [queryClient],
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => {
      const kind = kindFor(item.type);
      const { title, body } = textFor(item);
      const unread = !item.read_at;
      const icon = iconFor(kind);
      const iconColor =
        kind === 'report'
          ? colors.warning
          : kind === 'broadcast'
            ? colors.accent
            : kind === 'exchange'
              ? colors.info
              : colors.primary;

      return (
        <TouchableOpacity
          style={[
            styles.item,
            { backgroundColor: colors.surface, borderColor: colors.border },
            unread && { backgroundColor: colors.primarySoft, borderLeftColor: colors.primary },
          ]}
          onPress={() => handlePress(item)}
          activeOpacity={0.7}
          testID={`notif-${item.id}`}
        >
          <View style={[styles.iconWrap, { backgroundColor: isDark ? colors.surfaceAlt : colors.surface }]}>
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[styles.title, { color: colors.text }, unread && styles.titleUnread]}
                numberOfLines={2}
              >
                {title}
              </Text>
              <Text style={[styles.time, { color: colors.textMuted }]}>
                {formatRelative(item.created_at)}
              </Text>
            </View>
            {body ? (
              <Text style={[styles.body, { color: colors.textMuted }]} numberOfLines={3}>
                {body}
              </Text>
            ) : null}
          </View>

          {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
        </TouchableOpacity>
      );
    },
    [colors, isDark, handlePress],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={
          items.length === 0 ? styles.emptyList : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={notificationsQuery.isFetching && !notificationsQuery.isLoading}
            onRefresh={() => notificationsQuery.refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          notificationsQuery.isLoading ? null : (
            <EmptyState message="Bildirim yok" icon="notifications-outline" />
          )
        }
        testID="notifications-list"
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  emptyList: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
    borderWidth: 1,
    gap: spacing.md,
    ...shadows.card,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  titleUnread: {
    fontWeight: '800',
  },
  time: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  body: {
    fontSize: fontSize.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: spacing.xs,
  },
});
