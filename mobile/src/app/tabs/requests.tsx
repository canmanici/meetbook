import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, EmptyState, Skeleton, palette, spacing, fontSize, radius, type ThemeColors } from '@/components/ui';
import { acceptExchange, rejectExchange, listExchanges, type ExchangeSummary } from '@/lib/api/client';
import { EXCHANGE_STATUS_LABELS, EXCHANGE_STATUS_VARIANTS } from '@/constants/exchanges';
import { Ionicons } from '@expo/vector-icons';

type RequestTab = 'received' | 'sent';

export default function RequestsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<RequestTab>('received');

  const { data, isLoading } = useQuery({
    queryKey: ['exchanges', activeTab],
    queryFn: () => listExchanges({ role: activeTab }),
  });

  const items = data?.items ?? [];

  const tabs: { key: RequestTab; label: string }[] = [
    { key: 'received', label: 'Gelen' },
    { key: 'sent', label: 'Giden' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[
                  styles.tab,
                  isActive
                    ? { backgroundColor: colors.primary }
                    : { borderColor: colors.primary, borderWidth: 1 },
                ]}
                testID={`tab-${tab.key}`}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? colors.surface : colors.primary },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <>
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            message={activeTab === 'received' ? 'Henüz gelen talep yok' : 'Henüz giden talep yok'}
            description="Yakınındaki kitaplardan birini iste!"
            illustration={<Text style={styles.illustration}>📋</Text>}
            actionLabel="Kitaplara Göz At"
            onAction={() => router.push('/tabs/search')}
          />
        ) : activeTab === 'received' ? (
          items.map((item) => (
            <IncomingRequestRow key={item.id} item={item} colors={colors} queryClient={queryClient} />
          ))
        ) : (
          items.map((item) => (
            <OutgoingRequestRow key={item.id} item={item} colors={colors} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function IncomingRequestRow({
  item,
  colors,
  queryClient,
}: {
  item: ExchangeSummary;
  colors: ThemeColors;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const createdAt = new Date(item.created_at);
  const statusLabel = EXCHANGE_STATUS_LABELS[item.status] ?? item.status;
  const statusVariant = EXCHANGE_STATUS_VARIANTS[item.status] ?? 'info';

  const acceptMutation = useMutation({
    mutationFn: acceptExchange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
      Alert.alert('Onaylandı', 'Talep onaylandı.');
    },
    onError: () => {
      Alert.alert('Hata', 'Talep onaylanamadı.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectExchange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
      Alert.alert('Reddedildi', 'Talep reddedildi.');
    },
    onError: () => {
      Alert.alert('Hata', 'Talep reddedilemedi.');
    },
  });

  const isPending = item.status === 'pending';

  return (
    <View style={[styles.row, { backgroundColor: colors.surface }]} testID={`request-row-${item.id}`}>
      <View style={styles.rowHeader}>
        <LinearGradient
          colors={[colors.primary, colors.success]}
          style={styles.avatarGradient}
        >
          <Text style={styles.avatarText}>{item.counterpart.name.charAt(0)}</Text>
        </LinearGradient>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{item.counterpart.name}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>
            {item.book.title}
          </Text>
          <Text style={[styles.rowDate, { color: colors.textMuted }]}>
            {createdAt.toLocaleDateString('tr-TR')}
          </Text>
        </View>
        <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
      </View>
      {isPending && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => acceptMutation.mutate(item.id)}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
            testID={`accept-${item.id}`}
          >
            <LinearGradient
              colors={[colors.primary, colors.success]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.acceptButtonGradient}
            >
              <Text style={styles.acceptButtonText}>Onayla</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rejectButton, { borderColor: colors.danger }]}
            onPress={() => rejectMutation.mutate(item.id)}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
            testID={`reject-${item.id}`}
          >
            <Text style={[styles.rejectButtonText, { color: colors.danger }]}>Reddet</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function OutgoingRequestRow({
  item,
  colors,
}: {
  item: ExchangeSummary;
  colors: ThemeColors;
}) {
  const createdAt = new Date(item.created_at);
  const statusLabel = EXCHANGE_STATUS_LABELS[item.status] ?? item.status;
  const statusVariant = EXCHANGE_STATUS_VARIANTS[item.status] ?? 'info';

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.surface }]}
      onPress={() => router.push(`/exchange/${item.id}`)}
      testID={`request-row-${item.id}`}
    >
      <View style={styles.rowHeader}>
        <LinearGradient
          colors={[colors.accent, colors.warning]}
          style={styles.bookThumbGradient}
        >
          <Ionicons name="book" size={24} color={colors.surface} />
        </LinearGradient>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{item.book.title}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>
            {item.counterpart.name}
          </Text>
          <Text style={[styles.rowDate, { color: colors.textMuted }]}>
            {createdAt.toLocaleDateString('tr-TR')}
          </Text>
        </View>
        <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  tabText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  illustration: {
    fontSize: 64,
    marginBottom: spacing.xl,
  },
  row: {
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  bookThumbGradient: {
    width: 40,
    height: 40,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: fontSize.bodySm,
    marginTop: 2,
  },
  rowDate: {
    fontSize: fontSize.caption,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  acceptButton: {
    flex: 1,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  acceptButtonGradient: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.input,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  rejectButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  rejectButtonText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});
