import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
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

import { Badge, EmptyState, Skeleton, TrustBadge, palette, spacing, fontSize, radius, type ThemeColors } from '@/components/ui';
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['exchanges', activeTab],
    queryFn: () => listExchanges({ role: activeTab }),
    retry: false,
  });

  const items = data?.items ?? [];

  const tabs: { key: RequestTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'received', label: 'Gelen', icon: 'arrow-down-circle' },
    { key: 'sent', label: 'Giden', icon: 'arrow-up-circle' },
  ];

  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <EmptyState
          message="Talepler yüklenemedi"
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
      {/* Tabs */}
      <View style={styles.tabContainer}>
        <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt }]}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[
                  styles.tab,
                  isActive && styles.tabActive,
                ]}
                testID={`tab-${tab.key}`}
                accessibilityRole="button"
                accessibilityLabel={tab.key === 'received' ? 'Gelen talepler' : 'Giden talepler'}
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
                  size={16}
                  color={isActive ? '#fff' : colors.textMuted}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? '#fff' : colors.textMuted },
                  ]}
                >
                  {tab.label}
                </Text>
                {isActive && items.length > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: '#fff' }]}>
                    <Text style={[styles.tabBadgeText, { color: colors.primary }]}>{items.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
            icon={activeTab === 'received' ? 'arrow-down-circle' : 'arrow-up-circle'}
            actionLabel="Kitaplara Göz At"
            onAction={() => router.push('/tabs/home')}
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
  const isPending = item.status === 'pending';

  const acceptMutation = useMutation({
    mutationFn: acceptExchange,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
      Alert.alert('Onaylandı', 'Talep onaylandı.', [
        { text: 'Tamam', onPress: () => router.push(`/exchange/${data.id}`) }
      ]);
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

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Top accent line */}
      <LinearGradient
        colors={isPending ? [colors.primary, colors.primary + '88'] : [colors.textMuted + '44', colors.textMuted + '22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.cardAccent}
      />

      <TouchableOpacity
        onPress={() => router.push(`/exchange/${item.id}`)}
        testID={`request-row-${item.id}`}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Talep detayını görüntüle"
      >
        <View style={styles.cardContent}>
          {/* Avatar + Info */}
          <View style={styles.cardTop}>
            <View style={styles.avatarWrap}>
              <LinearGradient
                colors={[colors.primary, colors.primary + 'BB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarGradient}
              >
                <Text style={styles.avatarText}>{item.counterpart.name.charAt(0)}</Text>
              </LinearGradient>
              {isPending && (
                <View style={[styles.pulseDot, { backgroundColor: colors.success }]} />
              )}
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{item.counterpart.name}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                {item.book.title}
              </Text>
              <View style={styles.cardMeta}>
                <View style={[styles.metaTag, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name={item.mode === 'borrow' ? 'hand-left-outline' : 'swap-horizontal-outline'} size={12} color={colors.primary} />
                  <Text style={[styles.metaTagText, { color: colors.primary }]}>
                    {item.mode === 'borrow' ? 'Ödünç' : 'Takas'}
                  </Text>
                </View>
                <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.metaTagText, { color: colors.textMuted }]}>
                    {createdAt.toLocaleDateString('tr-TR')}
                  </Text>
                </View>
              </View>
            </View>
            <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
          </View>

          {/* Trust badge */}
          {item.counterpart.trust && (
            <View style={styles.trustRow}>
              <TrustBadge trust={item.counterpart.trust} showBorrowCount />
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Action buttons */}
      {isPending && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.acceptButtonWrap}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              acceptMutation.mutate(item.id);
            }}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
            activeOpacity={0.85}
            testID={`accept-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Talebi kabul et"
          >
            <LinearGradient
              colors={[colors.primary, colors.primary + 'CC']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.acceptButton}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.acceptButtonText}>Onayla</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rejectButtonWrap, { borderColor: colors.danger + '40' }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              rejectMutation.mutate(item.id);
            }}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
            activeOpacity={0.7}
            testID={`reject-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Talebi reddet"
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
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
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => router.push(`/exchange/${item.id}`)}
        testID={`request-row-${item.id}`}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Talep detayını görüntüle"
      >
        <View style={styles.cardContent}>
          <View style={styles.cardTop}>
            <View style={styles.avatarWrap}>
              <LinearGradient
                colors={[colors.accent, colors.warning]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarGradient}
              >
                <Ionicons name="book" size={20} color="#fff" />
              </LinearGradient>
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{item.book.title}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                {item.counterpart.name}
              </Text>
              <View style={styles.cardMeta}>
                <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.metaTagText, { color: colors.textMuted }]}>
                    {createdAt.toLocaleDateString('tr-TR')}
                  </Text>
                </View>
              </View>
            </View>
            <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
    marginLeft: 6,
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
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  cardAccent: {
    height: 3,
  },
  cardContent: {
    padding: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#11806B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  avatarText: {
    color: '#fff',
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  pulseDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '800',
    lineHeight: 20,
  },
  cardSubtitle: {
    fontSize: fontSize.bodySm,
    marginTop: 2,
    fontWeight: '500',
  },
  cardMeta: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  metaTagText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  trustRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  acceptButtonWrap: {
    flex: 1,
    borderRadius: radius.button,
    shadowColor: '#11806B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.button,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  rejectButtonWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: radius.button,
    paddingVertical: spacing.sm + 2,
  },
  rejectButtonText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});
