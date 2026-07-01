/**
 * SavedSearchesScreen — API-backed search configs with AsyncStorage offline fallback.
 *
 * Each saved search captures a snapshot of the home filter state:
 *   { id, category, radius_km, lat, lng, created_at }
 *
 * On mount we fetch from GET /saved-searches first; if the network is down we
 * fall back to AsyncStorage under `meetbook-saved-searches`.  Deletes go through
 * the API then update AsyncStorage as a backup cache.
 *
 * On open we reverse-geocode each saved center for a human location name and
 * query the bbox search endpoint for a live "match count" badge so the user
 * can see how many books currently match each saved search.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui/tokens';
import { EmptyState } from '@/components/ui';
import {
  getSavedSearches,
  deleteSavedSearch,
  searchBboxBooks,
  type BBoxParams,
  type SavedSearchItem,
} from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';

export const SAVED_SEARCHES_KEY = 'meetbook-saved-searches';

export interface SavedSearch {
  id: string;
  category: string | null;
  radius_km: number;
  lat: number;
  lng: number;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  fiction: 'Roman',
  non_fiction: 'Bilim',
  textbook: 'Ders',
  comics: 'Çizgi',
  children: 'Çocuk',
  poetry: 'Şiir',
  other: 'Diğer',
};

const BBOX_LIMIT = 50;

// ── Helpers ────────────────────────────────────────────────────────────────

function categoryLabel(category: string | null): string {
  if (!category) return 'Tümü';
  return CATEGORY_LABELS[category] ?? category;
}

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

function bboxFor(s: SavedSearch): BBoxParams {
  const degLat = s.radius_km / 111;
  const cosLat = Math.max(0.01, Math.cos((s.lat * Math.PI) / 180));
  const degLng = s.radius_km / (111 * cosLat);
  return {
    min_lat: s.lat - degLat,
    max_lat: s.lat + degLat,
    min_lng: s.lng - degLng,
    max_lng: s.lng + degLng,
    category: s.category ?? undefined,
    limit: BBOX_LIMIT,
  };
}

/** Map API response shape to the screen's flat SavedSearch interface. */
function fromApiItem(item: SavedSearchItem): SavedSearch {
  return {
    id: item.id,
    category: item.params?.category ?? null,
    radius_km: item.params?.radius_km ?? 0,
    lat: item.params?.lat ?? 0,
    lng: item.params?.lng ?? 0,
    created_at: item.created_at,
  };
}

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

// ── Component ──────────────────────────────────────────────────────────────

export default function SavedSearchesScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const toast = useToast();

  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [locationNames, setLocationNames] = useState<Record<string, string>>({});

  const loadFromStorage = useCallback(async (): Promise<SavedSearch[]> => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_SEARCHES_KEY);
      const parsed = raw ? (JSON.parse(raw) as SavedSearch[]) : [];
      setItems(parsed);
      return parsed;
    } catch {
      setItems([]);
      return [];
    }
  }, []);

  const loadSearches = useCallback(async (): Promise<SavedSearch[]> => {
    try {
      const response = await getSavedSearches();
      const mapped = (response.items ?? []).map(fromApiItem);
      // Cache to AsyncStorage as offline backup.
      await AsyncStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(mapped));
      setItems(mapped);
      return mapped;
    } catch {
      return loadFromStorage();
    }
  }, [loadFromStorage]);

  // Reverse-geocode + bbox-search each saved search for label + match badge.
  const enrich = useCallback(async (list: SavedSearch[]) => {
    if (list.length === 0) return;

    const countResults = await Promise.allSettled(
      list.map((s) => searchBboxBooks(bboxFor(s))),
    );
    const counts: Record<string, number> = {};
    countResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        counts[list[i].id] = r.value.items.length;
      }
    });
    setMatchCounts(counts);

    const geoResults = await Promise.allSettled(
      list.map((s) => Location.reverseGeocodeAsync({ latitude: s.lat, longitude: s.lng })),
    );
    const names: Record<string, string> = {};
    geoResults.forEach((r, i) => {
      const s = list[i];
      if (r.status === 'fulfilled' && r.value.length > 0) {
        const a = r.value[0];
        const parts = [a.city, a.district, a.region].filter(Boolean) as string[];
        names[s.id] = parts.slice(0, 2).join(', ') || a.name || formatCoords(s.lat, s.lng);
      } else {
        names[s.id] = formatCoords(s.lat, s.lng);
      }
    });
    setLocationNames(names);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const list = await loadSearches();
      if (!mounted) return;
      await enrich(list);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadSearches, enrich]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const list = await loadSearches();
    await enrich(list);
    setRefreshing(false);
  }, [loadSearches, enrich]);

  const handleDelete = useCallback(
    async (id: string) => {
      const prev = items;
      const next = prev.filter((s) => s.id !== id);
      setItems(next); // optimistic

      // Try API first; show toast result but keep local deletion either way.
      try {
        await deleteSavedSearch(id);
        toast.show('Arama silindi', { variant: 'success' });
      } catch {
        toast.show('Silinemedi', { variant: 'error' });
      }

      // Always update AsyncStorage as offline backup.
      try {
        await AsyncStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Silent — local state is already correct.
      }

      setMatchCounts((c) => {
        const { [id]: _omit, ...rest } = c;
        return rest;
      });
      setLocationNames((n) => {
        const { [id]: _omit, ...rest } = n;
        return rest;
      });
    },
    [items, toast],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedSearch }) => {
      const count = matchCounts[item.id];
      const locationName = locationNames[item.id];
      const countCapped = count === BBOX_LIMIT;
      return (
        <View
          style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID={`saved-search-${item.id}`}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="bookmark" size={20} color={colors.primary} />
          </View>

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {categoryLabel(item.category)}
              </Text>
              <Text style={[styles.time, { color: colors.textMuted }]}>
                {formatRelative(item.created_at)}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={colors.textMuted} />
              <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
                {locationName ?? 'Konum yükleniyor…'}
              </Text>
            </View>

            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="ellipse-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.tagText, { color: colors.text }]}>
                  {item.radius_km} km
                </Text>
              </View>
              {count !== undefined && (
                <View style={[styles.tag, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="book-outline" size={12} color={colors.primary} />
                  <Text style={[styles.tagText, { color: colors.primary, fontWeight: '700' }]}>
                    {count}
                    {countCapped ? '+' : ''} eşleşme
                  </Text>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            onPress={() => handleDelete(item.id)}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            testID={`saved-search-delete-${item.id}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      );
    },
    [colors, matchCounts, locationNames, handleDelete],
  );

  const empty = items.length === 0 && !loading;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={empty ? styles.emptyList : styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <EmptyState
              message="Henüz kayıtlı arama yok"
              description="Ana ekranda aramanızı yapıp yer imi düğmesine dokunun"
              icon="bookmark-outline"
            />
          )
        }
        testID="saved-searches-list"
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
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.card,
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
    fontWeight: '700',
  },
  time: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaText: {
    flex: 1,
    fontSize: fontSize.caption,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
