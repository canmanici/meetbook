import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { getStarredMessages, listChats } from '@/lib/api/chat';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) +
    ' · ' +
    `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function StarredMessagesScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({
    queryKey: ['starred-messages'],
    queryFn: () => getStarredMessages(),
  });
  const { data: chatsData } = useQuery({ queryKey: ['chats'], queryFn: listChats });

  const exchangeIdByChatId = useMemo(() => {
    const map = new Map<string, string>();
    chatsData?.items.forEach((c) => map.set(c.chat_id, c.exchange_id));
    return map;
  }, [chatsData]);

  const items = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Yıldızlı Mesajlar</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <>
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            message="Yıldızlı mesaj yok"
            description="Bir mesaja uzun basıp yıldızlayarak burada saklayabilirsiniz"
            icon="star-outline"
          />
        ) : (
          items.map((msg) => {
            const exchangeId = exchangeIdByChatId.get(msg.chat_id);
            return (
              <TouchableOpacity
                key={msg.id}
                style={[styles.row, { backgroundColor: colors.surface }]}
                onPress={() => {
                  if (exchangeId) router.push(`/chat/${exchangeId}`);
                }}
                disabled={!exchangeId}
                testID={`starred-message-${msg.id}`}
              >
                <Ionicons name="star" size={16} color="#E8A13A" style={{ marginTop: 2 }} />
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={3}>
                    {msg.text || 'Medya mesajı'}
                  </Text>
                  <Text style={[styles.rowDate, { color: colors.textMuted }]}>
                    {formatDate(msg.created_at)}
                  </Text>
                </View>
                {exchangeId && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  scrollContent: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowText: { fontSize: fontSize.bodySm, lineHeight: 20 },
  rowDate: { fontSize: fontSize.caption },
});
