import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/hooks/use-toast';
import { Badge, BookCover, EmptyState, Sheet, Skeleton, TrustBadge, palette, spacing, fontSize, radius, type ThemeColors } from '@/components/ui';
import {
  acceptExchange,
  getBook,
  getExchange,
  getMe,
  listExchanges,
  rejectExchange,
  updateMe,
  type ExchangeSummary,
} from '@/lib/api/client';
import { listChats, chatWS } from '@/lib/api/chat';
import { EXCHANGE_STATUS_LABELS, EXCHANGE_STATUS_VARIANTS } from '@/constants/exchanges';
import { BOOK_CATEGORIES, BOOK_CATEGORY_LABELS } from '@/constants/books';
import { Ionicons } from '@expo/vector-icons';

type RequestTab = 'received' | 'sent';
type StatusFilter = 'all' | 'pending' | 'active' | 'completed' | 'cancelled';

// B17: a smart rule that auto-accepts matching exchange requests.
type AutoAcceptRule = {
  category?: string | null;
  min_trust_score?: number | null;
  max_distance_km?: number | null;
};

function describeRule(rule: AutoAcceptRule): string {
  const parts: string[] = [];
  if (rule.category) {
    parts.push(BOOK_CATEGORY_LABELS[rule.category as keyof typeof BOOK_CATEGORY_LABELS] ?? rule.category);
  } else {
    parts.push('Tüm kategoriler');
  }
  if (rule.min_trust_score != null) {
    parts.push(`min güven ${rule.min_trust_score}`);
  }
  if (rule.max_distance_km != null) {
    parts.push(`max ${rule.max_distance_km} km`);
  }
  return parts.join(' · ');
}

// Group the many exchange statuses into 4 user-facing buckets
const ACTIVE_STATUSES = new Set([
  'accepted', 'meetup_proposed', 'meetup_confirmed', 'completion_pending', 'lent', 'return_pending', 'overdue',
]);
const COMPLETED_STATUSES = new Set(['completed']);
const CANCELLED_STATUSES = new Set(['rejected', 'cancelled', 'expired']);

function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return status === 'pending';
  if (filter === 'active') return ACTIVE_STATUSES.has(status);
  if (filter === 'completed') return COMPLETED_STATUSES.has(status);
  if (filter === 'cancelled') return CANCELLED_STATUSES.has(status);
  return true;
}

// F09: quick reject templates (Turkish)
const REJECT_TEMPLATES: readonly string[] = [
  'Şu an müsait değilim',
  'Kitabı başkasına söz verdim',
  'Uzak biraz fazla, başka zaman',
];
const CUSTOM_TEMPLATE = 'Özel mesaj yaz';
const RECENT_TEMPLATES_KEY = '@meetbook/recent-reject-templates';
const MAX_RECENT_TEMPLATES = 5;

async function loadRecentTemplates(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    // AsyncStorage unavailable (e.g. Expo Go) — non-fatal
    return [];
  }
}

async function saveRecentTemplate(text: string): Promise<void> {
  if (!text.trim()) return;
  try {
    const current = await loadRecentTemplates();
    const next = [text, ...current.filter((t) => t !== text)].slice(0, MAX_RECENT_TEMPLATES);
    await AsyncStorage.setItem(RECENT_TEMPLATES_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}

// F09: the reject API takes no message — best-effort send the template as a chat
// message after the reject succeeds. WS may not be open yet from the list
// screen, so we connect + retry a couple of times with a short delay.
async function sendRejectChatMessage(exchangeId: string, text: string): Promise<void> {
  try {
    const { items } = await listChats();
    const chatId = items.find((c) => c.exchange_id === exchangeId)?.chat_id;
    if (!chatId) return;
    chatWS.connect();
    const attempt = (delay: number) => {
      setTimeout(() => {
        if (!chatWS.send(chatId, text) && delay < 2600) attempt(delay + 800);
      }, delay);
    };
    attempt(500);
  } catch {
    // best-effort — the reject itself already succeeded
  }
}

export default function RequestsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<RequestTab>('received');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // F10: accordion — only one card expanded at a time
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // B17: auto-accept rules sheet + form state.
  const [rulesSheetVisible, setRulesSheetVisible] = useState(false);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [newMinTrust, setNewMinTrust] = useState('');
  const [newMaxDistance, setNewMaxDistance] = useState('');

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => getMe() });
  const autoAcceptRules: AutoAcceptRule[] = (meData as any)?.auto_accept_rules ?? [];

  const saveRulesMutation = useMutation({
    mutationFn: (rules: AutoAcceptRule[]) => updateMe({ auto_accept_rules: rules } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.show('Kurallar kaydedildi', { variant: 'success' });
    },
    onError: () => {
      toast.show('Kurallar kaydedilemedi', { variant: 'error' });
    },
  });

  const handleAddRule = () => {
    const minTrust = newMinTrust.trim() ? Number(newMinTrust) : null;
    const maxDist = newMaxDistance.trim() ? Number(newMaxDistance) : null;
    if (minTrust != null && (Number.isNaN(minTrust) || minTrust < 0 || minTrust > 100)) {
      toast.show('Güven puanı 0-100 olmalı', { variant: 'error' });
      return;
    }
    if (maxDist != null && (Number.isNaN(maxDist) || maxDist <= 0)) {
      toast.show('Mesafe geçerli değil', { variant: 'error' });
      return;
    }
    const rule: AutoAcceptRule = {
      category: newCategory,
      min_trust_score: minTrust,
      max_distance_km: maxDist,
    };
    saveRulesMutation.mutate([...autoAcceptRules, rule]);
    setNewCategory(null);
    setNewMinTrust('');
    setNewMaxDistance('');
  };

  const handleRemoveRule = (idx: number) => {
    const next = autoAcceptRules.filter((_, i) => i !== idx);
    saveRulesMutation.mutate(next);
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['exchanges', activeTab],
    queryFn: () => listExchanges({ role: activeTab }),
    retry: false,
  });

  const items = data?.items ?? [];
  const filteredItems = items.filter((i) => matchesFilter(i.status, statusFilter));

  const toggleExpand = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId((cur) => (cur === id ? null : id));
  };

  const handleTabChange = (tab: RequestTab) => {
    setExpandedId(null);
    setActiveTab(tab);
  };

  const handleFilterChange = (filter: StatusFilter) => {
    setExpandedId(null);
    setStatusFilter(filter);
  };

  const tabs: { key: RequestTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'received', label: 'Gelen', icon: 'arrow-down-circle' },
    { key: 'sent', label: 'Giden', icon: 'arrow-up-circle' },
  ];

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Tümü' },
    { key: 'pending', label: 'Beklemede' },
    { key: 'active', label: 'Aktif' },
    { key: 'completed', label: 'Tamamlandı' },
    { key: 'cancelled', label: 'İptal/Red' },
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
      {/* Page header */}
      <View style={[styles.pageHeader, { borderBottomColor: colors.border }]}>
        <View style={styles.pageHeaderLeft}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>Talepler</Text>
          {items.length > 0 && (
            <View style={[styles.pageCount, { backgroundColor: colors.primary + '18' }]}>
              <Text style={[styles.pageCountText, { color: colors.primary }]}>{items.length}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.rulesBtn, { borderColor: colors.primary + '40' }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setRulesSheetVisible(true);
          }}
          activeOpacity={0.7}
          testID="auto-accept-rules-btn"
          accessibilityRole="button"
          accessibilityLabel="Otomatik kabul kuralları"
        >
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          <Text style={[styles.rulesBtnText, { color: colors.primary }]}>Kurallar</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt }]}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => handleTabChange(tab.key)}
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

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {statusFilters.map((filter) => {
          const isActive = statusFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              onPress={() => handleFilterChange(filter.key)}
              style={[
                styles.chip,
                { backgroundColor: isActive ? colors.primary : colors.surfaceAlt, borderColor: isActive ? colors.primary : colors.border },
              ]}
              testID={`status-filter-${filter.key}`}
              accessibilityRole="button"
              accessibilityLabel={`${filter.label} talepleri filtrele`}
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: isActive ? '#fff' : colors.textMuted },
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <>
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            message={items.length === 0
              ? (activeTab === 'received' ? 'Henüz gelen talep yok' : 'Henüz giden talep yok')
              : 'Bu filtreye uygun talep yok'}
            description={items.length === 0 ? 'Yakınındaki kitaplardan birini iste!' : 'Farklı bir filtre deneyin.'}
            icon={activeTab === 'received' ? 'arrow-down-circle' : 'arrow-up-circle'}
            actionLabel={items.length === 0 ? 'Kitaplara Göz At' : undefined}
            onAction={items.length === 0 ? () => router.push('/tabs/home') : undefined}
          />
        ) : activeTab === 'received' ? (
          filteredItems.map((item) => (
            <IncomingRequestRow
              key={item.id}
              item={item}
              colors={colors}
              queryClient={queryClient}
              expanded={expandedId === item.id}
              onToggleExpand={toggleExpand}
            />
          ))
        ) : (
          filteredItems.map((item) => (
            <OutgoingRequestRow
              key={item.id}
              item={item}
              colors={colors}
              expanded={expandedId === item.id}
              onToggleExpand={toggleExpand}
            />
          ))
        )}
      </ScrollView>

      {/* B17: Auto-accept rules sheet */}
      <Sheet
        visible={rulesSheetVisible}
        onClose={() => setRulesSheetVisible(false)}
        style={{ backgroundColor: colors.surface }}
      >
        <View testID="auto-accept-rules-sheet">
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Otomatik Kabul Kuralları</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>
            Eşleşen takas isteklerini otomatik kabul et
          </Text>

          {autoAcceptRules.length > 0 ? (
            <View style={styles.rulesList}>
              {autoAcceptRules.map((rule, idx) => (
                <View
                  key={idx}
                  style={[styles.ruleRow, { borderBottomColor: colors.border }]}
                >
                  <Text style={[styles.ruleRowText, { color: colors.text }]} numberOfLines={2}>
                    {describeRule(rule)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveRule(idx)}
                    disabled={saveRulesMutation.isPending}
                    hitSlop={8}
                    testID={`remove-rule-${idx}`}
                    accessibilityRole="button"
                    accessibilityLabel="Kuralı sil"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.rulesEmpty, { color: colors.textMuted }]}>
              Henüz kural eklenmedi
            </Text>
          )}

          <View style={styles.ruleForm}>
            <Text style={[styles.formLabel, { color: colors.textMuted }]}>KATEGORİ</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryChips}
            >
              <TouchableOpacity
                onPress={() => setNewCategory(null)}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: newCategory == null ? colors.primary : colors.surfaceAlt,
                    borderColor: newCategory == null ? colors.primary : colors.border,
                  },
                ]}
                testID="rule-category-all"
                accessibilityRole="button"
                accessibilityLabel="Tüm kategoriler"
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: newCategory == null ? '#fff' : colors.textMuted },
                  ]}
                >
                  Tümü
                </Text>
              </TouchableOpacity>
              {BOOK_CATEGORIES.map((cat) => {
                const active = newCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setNewCategory(cat)}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: active ? colors.primary : colors.surfaceAlt,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    testID={`rule-category-${cat}`}
                    accessibilityRole="button"
                    accessibilityLabel={BOOK_CATEGORY_LABELS[cat]}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        { color: active ? '#fff' : colors.textMuted },
                      ]}
                    >
                      {BOOK_CATEGORY_LABELS[cat]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.formLabel, { color: colors.textMuted }]}>MİN GÜVEN PUANI (0-100)</Text>
            <TextInput
              value={newMinTrust}
              onChangeText={setNewMinTrust}
              placeholder="örn. 60"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              testID="rule-min-trust-input"
              accessibilityLabel="Minimum güven puanı"
            />

            <Text style={[styles.formLabel, { color: colors.textMuted }]}>MAKS MESAFE (KM)</Text>
            <TextInput
              value={newMaxDistance}
              onChangeText={setNewMaxDistance}
              placeholder="örn. 5"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              testID="rule-max-distance-input"
              accessibilityLabel="Maksimum mesafe"
            />

            <TouchableOpacity
              onPress={handleAddRule}
              disabled={saveRulesMutation.isPending}
              activeOpacity={0.85}
              style={[styles.addRuleBtn, { backgroundColor: colors.primary, opacity: saveRulesMutation.isPending ? 0.5 : 1 }]}
              testID="add-rule-btn"
              accessibilityRole="button"
              accessibilityLabel="Kural ekle"
            >
              <Text style={styles.addRuleBtnText}>Kural Ekle</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const renderLeftActions = () => (
  <View style={{ backgroundColor: '#34C759', justifyContent: 'center', paddingLeft: 20, flex: 1 }}>
    <Ionicons name="checkmark" size={24} color="#fff" />
    <Text style={{ color: '#fff', fontSize: 12 }}>Kabul Et</Text>
  </View>
);

const renderRightActions = () => (
  <View style={{ backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'flex-end', paddingRight: 20, flex: 1 }}>
    <Ionicons name="close" size={24} color="#fff" />
    <Text style={{ color: '#fff', fontSize: 12 }}>Reddet</Text>
  </View>
);

function IncomingRequestRow({
  item,
  colors,
  queryClient,
  expanded,
  onToggleExpand,
}: {
  item: ExchangeSummary;
  colors: ThemeColors;
  queryClient: ReturnType<typeof useQueryClient>;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const toast = useToast();
  const createdAt = new Date(item.created_at);
  const statusLabel = EXCHANGE_STATUS_LABELS[item.status] ?? item.status;
  const statusVariant = EXCHANGE_STATUS_VARIANTS[item.status] ?? 'info';
  const isPending = item.status === 'pending';
  const canMessage = !CANCELLED_STATUSES.has(item.status);

  const photos = [...(item.book.photos ?? [])].sort((a, b) => a.position - b.position);
  const coverThumb = photos[0]?.thumbnail_url ?? photos[0]?.url ?? null;

  // F09: reject-sheet state
  const [rejectSheetVisible, setRejectSheetVisible] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [recentTemplates, setRecentTemplates] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    loadRecentTemplates().then((t) => {
      if (mounted) setRecentTemplates(t);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const acceptMutation = useMutation({
    mutationFn: acceptExchange,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
      toast.show('Talep kabul edildi', { variant: 'success' });
      router.push(`/exchange/${data.id}`);
    },
    onError: () => {
      toast.show('Talep kabul edilemedi', { variant: 'error' });
    },
  });

  // F09: optional reason — when present, the template is best-effort sent as a
  // chat message after the reject succeeds (the reject API takes no message).
  const rejectMutation = useMutation({
    mutationFn: (_vars: { reason?: string } = {}) => rejectExchange(item.id),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
      const reason = vars?.reason;
      if (reason) {
        sendRejectChatMessage(item.id, reason);
        saveRecentTemplate(reason);
      }
      toast.show('Talep reddedildi', { variant: 'success' });
      setRejectSheetVisible(false);
      setCustomMode(false);
      setCustomText('');
    },
    onError: () => {
      toast.show('Talep reddedilemedi', { variant: 'error' });
    },
  });

  const closeRejectSheet = () => {
    setRejectSheetVisible(false);
    setCustomMode(false);
    setCustomText('');
  };

  const handleSelectTemplate = (tpl: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    rejectMutation.mutate({ reason: tpl });
  };

  const handleSendCustom = () => {
    const text = customText.trim();
    if (!text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    rejectMutation.mutate({ reason: text });
  };

  // F09: recently-used templates that aren't already in the default list
  const extraRecent = recentTemplates.filter(
    (t) => !REJECT_TEMPLATES.includes(t) && t !== CUSTOM_TEMPLATE,
  );

  return (
    <Swipeable
      renderLeftActions={isPending ? renderLeftActions : undefined}
      renderRightActions={isPending ? renderRightActions : undefined}
      onSwipeableOpen={(direction, swipeable) => {
        swipeable.close();
        if (acceptMutation.isPending || rejectMutation.isPending) return;
        if (direction === 'left') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          acceptMutation.mutate(item.id);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          // Swipe = quick reject (no template). Use the button for templates.
          rejectMutation.mutate({});
        }
      }}
    >
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Top accent line */}
      <LinearGradient
        colors={isPending ? [colors.primary, colors.primary + '88'] : [colors.textMuted + '44', colors.textMuted + '22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.cardAccent}
      />

      <TouchableOpacity
        onPress={() => onToggleExpand(item.id)}
        testID={`request-row-${item.id}`}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Talep detayını gizle' : 'Talep detayını genişlet'}
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
              <View style={styles.bookLine}>
                <BookCover url={coverThumb} size={26} radius={4} />
                <Text
                  style={[styles.cardSubtitle, { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {item.book.title}
                </Text>
              </View>
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
            <View style={styles.statusCol}>
              <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
              <Ionicons
                name="chevron-down"
                size={16}
                color={colors.textMuted}
                style={[styles.chevron, expanded && styles.chevronOpen]}
              />
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {/* F10: expanded inline preview */}
      {expanded && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} testID={`expanded-${item.id}`}>
          <ExpandedDetails item={item} colors={colors} />

          {/* Action buttons */}
          <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
            {isPending && (
              <>
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
                    setRejectSheetVisible(true);
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
              </>
            )}
            {canMessage && !isPending && (
              <TouchableOpacity
                style={[styles.secondaryButtonWrap, { borderColor: colors.primary + '40' }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/chat/${item.id}`);
                }}
                activeOpacity={0.7}
                testID={`message-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel="Mesaj gönder"
              >
                <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Mesaj</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.detailLinkWrap}
              onPress={() => router.push(`/exchange/${item.id}`)}
              activeOpacity={0.6}
              testID={`detail-link-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel="Tüm detayları gör"
            >
              <Text style={[styles.detailLinkText, { color: colors.textMuted }]}>Tüm detaylar</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>

    {/* F09: quick reject template sheet */}
    <Sheet visible={rejectSheetVisible} onClose={closeRejectSheet} style={{ backgroundColor: colors.surface }}>
      <View testID={`reject-sheet-${item.id}`}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>Reddet</Text>
        <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>Hızlı bir yanıt seçin</Text>

        {!customMode ? (
          <View>
            {REJECT_TEMPLATES.map((tpl) => (
              <TouchableOpacity
                key={tpl}
                onPress={() => handleSelectTemplate(tpl)}
                style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                disabled={rejectMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel={tpl}
              >
                <Text style={[styles.sheetRowText, { color: colors.text }]}>{tpl}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}

            {extraRecent.length > 0 && (
              <View style={styles.sheetGroup}>
                <Text style={[styles.sheetGroupLabel, { color: colors.textMuted }]}>SON KULLANILANLAR</Text>
                {extraRecent.map((tpl) => (
                  <TouchableOpacity
                    key={tpl}
                    onPress={() => handleSelectTemplate(tpl)}
                    style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                    disabled={rejectMutation.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={tpl}
                  >
                    <Text style={[styles.sheetRowText, { color: colors.text }]} numberOfLines={2}>{tpl}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => setCustomMode(true)}
              style={[styles.sheetRow, styles.customRow, { borderBottomColor: colors.border }]}
              disabled={rejectMutation.isPending}
              testID={`reject-custom-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel="Özel mesaj yaz"
            >
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <Text style={[styles.sheetRowText, { color: colors.primary, flex: 1 }]}>{CUSTOM_TEMPLATE}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <TextInput
              value={customText}
              onChangeText={setCustomText}
              placeholder="Reddetme nedeninizi yazın..."
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              maxLength={500}
              style={[styles.customInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
              testID={`custom-message-input-${item.id}`}
              accessibilityLabel="Özel reddetme mesajı"
            />
            <View style={styles.customActions}>
              <TouchableOpacity
                onPress={() => setCustomMode(false)}
                style={styles.customBackBtn}
                disabled={rejectMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Geri"
              >
                <Text style={[styles.customBackText, { color: colors.textMuted }]}>Geri</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendCustom}
                disabled={!customText.trim() || rejectMutation.isPending}
                style={[styles.customSendBtn, { backgroundColor: colors.danger, opacity: !customText.trim() || rejectMutation.isPending ? 0.5 : 1 }]}
                testID={`reject-send-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel="Reddet ve gönder"
              >
                <Text style={styles.customSendText}>Reddet</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Sheet>
    </Swipeable>
  );
}

function OutgoingRequestRow({
  item,
  colors,
  expanded,
  onToggleExpand,
}: {
  item: ExchangeSummary;
  colors: ThemeColors;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const createdAt = new Date(item.created_at);
  const statusLabel = EXCHANGE_STATUS_LABELS[item.status] ?? item.status;
  const statusVariant = EXCHANGE_STATUS_VARIANTS[item.status] ?? 'info';
  const isPending = item.status === 'pending';
  const canMessage = !CANCELLED_STATUSES.has(item.status);

  const photos = [...(item.book.photos ?? [])].sort((a, b) => a.position - b.position);
  const coverThumb = photos[0]?.thumbnail_url ?? photos[0]?.url ?? null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <LinearGradient
        colors={[colors.textMuted + '44', colors.textMuted + '22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.cardAccent}
      />
      <TouchableOpacity
        onPress={() => onToggleExpand(item.id)}
        testID={`request-row-${item.id}`}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Talep detayını gizle' : 'Talep detayını genişlet'}
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
              <View style={styles.bookLine}>
                <BookCover url={coverThumb} size={26} radius={4} />
                <Text style={[styles.cardSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.counterpart.name}
                </Text>
              </View>
              <View style={styles.cardMeta}>
                <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.metaTagText, { color: colors.textMuted }]}>
                    {createdAt.toLocaleDateString('tr-TR')}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.statusCol}>
              <Badge text={statusLabel} variant={statusVariant} testID={`request-status-${item.id}`} />
              <Ionicons
                name="chevron-down"
                size={16}
                color={colors.textMuted}
                style={[styles.chevron, expanded && styles.chevronOpen]}
              />
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} testID={`expanded-${item.id}`}>
          <ExpandedDetails item={item} colors={colors} />
          <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
            {canMessage && !isPending && (
              <TouchableOpacity
                style={[styles.secondaryButtonWrap, { borderColor: colors.primary + '40' }]}
                onPress={() => router.push(`/chat/${item.id}`)}
                activeOpacity={0.7}
                testID={`message-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel="Mesaj gönder"
              >
                <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Mesaj</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.detailLinkWrap}
              onPress={() => router.push(`/exchange/${item.id}`)}
              activeOpacity={0.6}
              testID={`detail-link-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel="Tüm detayları gör"
            >
              <Text style={[styles.detailLinkText, { color: colors.textMuted }]}>Tüm detaylar</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * F10: shared inline preview shown when a request card is expanded.
 * Fetches the full book (for description) + the exchange detail (for the
 * requester note + proposed meetup). Photos and trust are already on the
 * summary so they render instantly; the fetched fields fill in after.
 */
function ExpandedDetails({ item, colors }: { item: ExchangeSummary; colors: ThemeColors }) {
  const { data: book } = useQuery({
    queryKey: ['book', item.book.id],
    queryFn: () => getBook(item.book.id),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data: exchange } = useQuery({
    queryKey: ['exchange', item.id],
    queryFn: () => getExchange(item.id),
    retry: false,
    staleTime: 60 * 1000,
  });

  const photos = [...(item.book.photos ?? [])].sort((a, b) => a.position - b.position);
  const description = book?.description ?? null;
  const language = book?.language ?? null;
  const initialMessage = exchange?.initial_message ?? null;
  const meetup = exchange?.meetup ?? null;
  const author = item.book.author ?? null;

  const hasMeta = Boolean(author || language || item.book.condition);

  return (
    <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
      {/* Book description */}
      {description ? (
        <Text style={[styles.description, { color: colors.text }]} numberOfLines={6}>
          {description}
        </Text>
      ) : null}

      {/* Book meta row */}
      {hasMeta ? (
        <View style={styles.metaRow}>
          {author ? (
            <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="person-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.metaTagText, { color: colors.textMuted }]} numberOfLines={1}>{author}</Text>
            </View>
          ) : null}
          {language ? (
            <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="language-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.metaTagText, { color: colors.textMuted }]}>{language}</Text>
            </View>
          ) : null}
          {item.book.condition ? (
            <View style={[styles.metaTag, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="sparkles-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.metaTagText, { color: colors.textMuted }]}>{item.book.condition}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* All photos (horizontal scroll) */}
      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.photosScroll}
          contentContainerStyle={styles.photosContent}
        >
          {photos.map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.thumbnail_url ?? photo.url }}
              style={styles.photoItem}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Counterpart trust badge */}
      {item.counterpart.trust ? (
        <View style={styles.trustRow}>
          <TrustBadge trust={item.counterpart.trust} showBorrowCount />
        </View>
      ) : null}

      {/* Request note (the requester's initial message) */}
      {initialMessage ? (
        <View style={[styles.noteBox, { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.primary }]}>
          <Text style={[styles.noteLabel, { color: colors.textMuted }]}>TALEP NOTU</Text>
          <Text style={[styles.noteText, { color: colors.text }]}>{initialMessage}</Text>
        </View>
      ) : null}

      {/* Meetup location (if proposed) */}
      {meetup ? (
        <View style={[styles.meetupBox, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
          <View style={styles.meetupHeader}>
            <Ionicons name="location-outline" size={16} color={colors.primary} />
            <Text style={[styles.meetupTitle, { color: colors.primary }]}>{meetup.place_name}</Text>
          </View>
          {meetup.address ? (
            <Text style={[styles.meetupText, { color: colors.text }]}>{meetup.address}</Text>
          ) : null}
          <Text style={[styles.meetupTime, { color: colors.textMuted }]}>
            {new Date(meetup.scheduled_at).toLocaleString('tr-TR', {
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pageTitle: {
    fontSize: fontSize.heading,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pageCount: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pageCountText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
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
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
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
  bookLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  cardSubtitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    flex: 1,
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
  statusCol: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  // F10: expanded preview
  expandedSection: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  description: {
    fontSize: fontSize.bodySm,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  photosScroll: {
    marginHorizontal: -spacing.md,
  },
  photosContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  photoItem: {
    width: 96,
    height: 140,
    borderRadius: radius.input,
  },
  trustRow: {
    paddingTop: spacing.xs,
  },
  noteBox: {
    padding: spacing.sm + 2,
    borderRadius: radius.input,
    borderLeftWidth: 3,
  },
  noteLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  noteText: {
    fontSize: fontSize.bodySm,
    lineHeight: 20,
  },
  meetupBox: {
    padding: spacing.sm + 2,
    borderRadius: radius.input,
    borderWidth: 1,
    gap: 2,
  },
  meetupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meetupTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  meetupText: {
    fontSize: fontSize.caption,
  },
  meetupTime: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  // Action buttons (moved into expanded view)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  acceptButtonWrap: {
    flex: 1,
    minWidth: 120,
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
    minWidth: 120,
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
  secondaryButtonWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: radius.button,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  detailLinkWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginLeft: 'auto',
  },
  detailLinkText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  // F09: reject sheet
  sheetTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sheetSubtitle: {
    fontSize: fontSize.caption,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  sheetRowText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  customRow: {
    gap: spacing.sm,
  },
  sheetGroup: {
    marginTop: spacing.sm,
  },
  sheetGroupLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  customInput: {
    borderWidth: 1,
    borderRadius: radius.field,
    padding: spacing.sm + 2,
    minHeight: 96,
    textAlignVertical: 'top',
    fontSize: fontSize.bodySm,
  },
  customActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  customBackBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  customBackText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  customSendBtn: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.button,
  },
  customSendText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  // B17: auto-accept rules sheet
  rulesList: {
    marginBottom: spacing.md,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  ruleRowText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    flex: 1,
  },
  rulesEmpty: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  ruleForm: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  formLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
    marginTop: spacing.xs,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: radius.field,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.bodySm,
  },
  categoryScroll: {
    marginHorizontal: -spacing.md,
  },
  categoryChips: {
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    alignItems: 'center',
  },
  categoryChip: {
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  addRuleBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.button,
    marginTop: spacing.md,
  },
  addRuleBtnText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
});
