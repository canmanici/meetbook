/**
 * HomeScreen — spec §3.1 map-first home (full nuclear rewrite).
 *
 * The map IS the home. List lives in a draggable bottom sheet.
 * Every marker tells a story (category, distance, freshness, shelf grouping).
 *
 * Key architecture:
 *   - ClusteredMapView with supercluster re-enabled (bug #1)
 *   - getBookClusters(bbox) → shelf markers (backend 30m clustering) + singletons
 *   - searchBboxBooks(bbox) → sheet list (full book data)
 *   - "Search this area" → re-query visible bbox (§3.7)
 *   - Marker tap → preview card (no navigation) + sheet snaps to peek (§3.5)
 *   - Long-press map → "Add book here" confirmation (§3.9)
 *   - Radius circle = geofence radius from user settings (§3.8, §4.5)
 *   - QuickRadiusSheet from radius chip → PATCH /auth/me (§4.5)
 *   - Debounced mapRegion 300ms (bug #5), pill 500ms (§3.7)
 *   - Bug #6: count booksWithLocation, not books.length
 *   - Dark mode: light.json/dark.json map styles + themed sheet + themed markers
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  Dimensions,
  useColorScheme,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Camera,
  type Region,
  MAPLIBRE_AVAILABLE,
  MAP_STYLE,
  MLMap,
} from '@/lib/map-adapter';

import { palette, spacing, fontSize, radius, shadows, type ThemeColors } from '@/components/ui/tokens';
import { BookCard, FilterSheet, type FilterState } from '@/components/ui';
import { BookMarker, categoryColor, dominantCategoryColor, type BookCategory, type MarkerVariant } from '@/components/ui/book-marker';
import {
  searchBboxBooks,
  getBookClusters,
  getMe,
  updateGeofenceRadius,
  type BBoxParams,
  type BookSearchResult,
  type ClusterPoint,
} from '@/lib/api/client';
import { useFavoritesStore } from '@/stores/favorites';
import { useToast } from '@/hooks/use-toast';
import BookBottomSheet, { DEFAULT_SNAP_INDEX } from '@/components/map/book-bottom-sheet';
import MarkerPreviewCard, { type PreviewBook } from '@/components/map/marker-preview-card';
import { RightControls } from '@/components/map/right-controls';
import { SearchAreaPill } from '@/components/map/search-area-pill';
import { RadiusCircle } from '@/components/map/radius-circle';
import { UserLocationDot } from '@/components/map/user-location-dot';
import QuickRadiusSheet from '@/components/map/quick-radius-sheet';

// ── Constants ──────────────────────────────────────────────────────────────

const WINDOW_H = Dimensions.get('window').height;
const WINDOW_W = Dimensions.get('window').width;
const SHEET_PEEK_PX = Math.round(WINDOW_H * 0.18);

const CATEGORIES: Array<{ value: BookCategory | null; label: string }> = [
  { value: null, label: 'Tümü' },
  { value: 'fiction', label: 'Roman' },
  { value: 'non_fiction', label: 'Bilim' },
  { value: 'textbook', label: 'Ders' },
  { value: 'comics', label: 'Çizgi' },
  { value: 'children', label: 'Çocuk' },
  { value: 'poetry', label: 'Şiir' },
  { value: 'other', label: 'Diğer' },
];

const MAP_TYPES: Array<'standard' | 'satellite' | 'hybrid'> = ['standard', 'satellite', 'hybrid'];
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const REGION_DEBOUNCE_MS = 300;
const PILL_DEBOUNCE_MS = 500;
const DRIFT_THRESHOLD = 0.2; // 20% of viewport
// Hard cap on the bbox search (backend /books/search-bbox enforces le=50).
// When the response hits this cap the count is "50+" — there may be more books
// in the viewport than we fetched. Zooming in re-queries a smaller bbox and
// reveals the true count for that area.
const BBOX_LIMIT = 50;

// ── Helpers ────────────────────────────────────────────────────────────────

function regionToBbox(region: Region): BBoxParams {
  return {
    min_lat: region.latitude - region.latitudeDelta / 2,
    max_lat: region.latitude + region.latitudeDelta / 2,
    min_lng: region.longitude - region.longitudeDelta / 2,
    max_lng: region.longitude + region.longitudeDelta / 2,
  };
}

function deltaToZoom(delta: number): number {
  return Math.max(0, Math.min(20, Math.log2(360 / delta)));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function getSingletonVariant(book: BookSearchResult): MarkerVariant {
  if (!book.is_available) return 'unavailable';
  if (Date.now() - new Date(book.created_at).getTime() < FRESH_WINDOW_MS) return 'fresh';
  if (book.category === 'textbook') return 'textbook';
  return 'standard';
}

function getFreshAgeHours(book: BookSearchResult): number | undefined {
  const ageMs = Date.now() - new Date(book.created_at).getTime();
  if (ageMs < FRESH_WINDOW_MS) {
    return Math.max(1, Math.floor(ageMs / (60 * 60 * 1000)));
  }
  return undefined;
}

function buildPreviewBook(book: BookSearchResult, isFavorited: boolean): PreviewBook {
  const owner = (book as any).owner; // spec §4.3: might not exist yet
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    coverUrl: book.photos?.[0]?.thumbnail_url ?? book.photos?.[0]?.url ?? null,
    category: book.category,
    condition: book.condition,
    distanceKm: book.distance_km,
    ownerId: book.owner_id,
    ownerName: book.owner_name,
    ownerBookCount: owner?.book_count,
    ownerRatingAvg: owner?.rating_avg,
    ownerRatingCount: owner?.rating_count,
    isFavorited,
    createdAt: book.created_at,
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const favoritesStore = useFavoritesStore();

  // ── State ──────────────────────────────────────────────────────────────────
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [queryBbox, setQueryBbox] = useState<BBoxParams | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedBook, setSelectedBook] = useState<PreviewBook | null>(null);
  const [showSearchPill, setShowSearchPill] = useState(false);
  const [mapTypeIndex, setMapTypeIndex] = useState(0);
  const [sheetSnapIndex, setSheetSnapIndex] = useState(DEFAULT_SNAP_INDEX);
  const [sortBy, setSortBy] = useState<'distance' | 'newest'>('distance');
  const [filterVisible, setFilterVisible] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
    radiusKm: 10,
  });
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 41.0082,
    longitude: 28.9784,
    latitudeDelta: 0.15,
    longitudeDelta: 0.15,
  });
  const [showRadiusSheet, setShowRadiusSheet] = useState(false);
  const [geofenceRadiusKm, setGeofenceRadiusKm] = useState(10);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastQueriedCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track the last queried latitudeDelta so we can detect ZOOM changes (not
  // just pan). Without this, zooming in keeps the same center → the drift
  // pill never shows → the user can't re-query the tighter viewport →
  // "can't get closer" bug.
  const lastQueriedZoomRef = useRef<number | null>(null);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Location + initial bbox ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let userLoc: { lat: number; lng: number };
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        userLoc = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      } else {
        // Fallback: Istanbul center
        userLoc = { lat: 41.0082, lng: 28.9784 };
      }
      setUserLocation(userLoc);
      const initialRegion: Region = {
        latitude: userLoc.lat,
        longitude: userLoc.lng,
        latitudeDelta: 0.15,
        longitudeDelta: 0.15,
      };
      setMapRegion(initialRegion);
      setQueryBbox(regionToBbox(initialRegion));
      lastQueriedCenterRef.current = userLoc;
      lastQueriedZoomRef.current = initialRegion.latitudeDelta;
    })();
  }, []);

  // ── Fly camera to user location once GPS resolves ──────────────────────────
  const hasFlownToLocation = useRef(false);
  useEffect(() => {
    if (userLocation && cameraRef.current && !hasFlownToLocation.current) {
      hasFlownToLocation.current = true;
      // Brief delay so the map has time to finish loading MapTiler tiles
      const t = setTimeout(() => {
        cameraRef.current?.flyTo({
          center: [userLocation.lng, userLocation.lat],
          zoom: 11,
          duration: 1200,
        });
      }, 800);
      return () => clearTimeout(t);
    }
  }, [userLocation]);

  // ── User profile (for geofence radius) ─────────────────────────────────────
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    staleTime: Infinity,
  });

  useEffect(() => {
    const r = (meData as any)?.geofence_radius_km;
    if (typeof r === 'number' && r >= 1 && r <= 100) {
      setGeofenceRadiusKm(r);
    }
  }, [meData]);

  // ── Bbox search (PRIMARY: feeds both sheet list AND markers) ──────────────
  const filterCategory = selectedCategory ?? activeFilters.category ?? undefined;

  const bboxQuery = useQuery({
    queryKey: ['books', 'bbox', queryBbox, filterCategory, searchText, activeFilters.condition, activeFilters.language],
    queryFn: async () => {
      try {
        return await searchBboxBooks({
          ...(queryBbox as BBoxParams),
          category: filterCategory,
          condition: activeFilters.condition ?? undefined,
          language: activeFilters.language ?? undefined,
          q: searchText || undefined,
          limit: BBOX_LIMIT,
        });
      } catch (err: any) {
        // 422 = "Alan çok geniş" — bbox too wide, don't crash
        if (err?.status === 422 || err?.response?.status === 422) {
          toast.show('Alan çok geniş — yakınlaştırın', { variant: 'error' });
          return { items: [], next_cursor: null };
        }
        throw err;
      }
    },
    enabled: !!queryBbox,
    staleTime: 60_000,
    retry: 1,
  });
  const books = useMemo(() => bboxQuery.data?.items ?? [], [bboxQuery.data]);

  // ── Clusters (ENHANCEMENT: shelf markers, optional — fallback to bbox books) ─
  const clustersQuery = useQuery({
    queryKey: ['books', 'clusters', queryBbox, filterCategory, searchText, activeFilters.condition, activeFilters.language],
    queryFn: () =>
      getBookClusters({
        ...(queryBbox as BBoxParams),
        category: filterCategory,
        condition: activeFilters.condition ?? undefined,
        language: activeFilters.language ?? undefined,
        q: searchText || undefined,
      }),
    enabled: !!queryBbox,
    staleTime: 60_000,
    retry: 0, // don't retry — if it fails, we fall back to bbox books for markers
  });
  const clusters = useMemo(() => clustersQuery.data?.clusters ?? [], [clustersQuery.data]);
  const clustersSingletons = useMemo(() => clustersQuery.data?.singletons ?? [], [clustersQuery.data]);
  const clustersSucceeded = clustersQuery.isSuccess && clustersQuery.data !== undefined;

  // Markers: use clusters singletons if any exist, otherwise fall back to ALL
  // bbox books. This ensures markers always render when books exist, even if
  // the clusters endpoint returns empty singletons while bbox found books.
  const markerBooks = useMemo(
    () => (clustersSingletons.length > 0 ? clustersSingletons : books),
    [clustersSingletons, books],
  );

  // ── Bug #6: count books WITH location ──────────────────────────────────────
  const booksWithLocation = useMemo(
    () => books.filter((b) => b.public_location && b.public_location.lat != null),
    [books],
  );

  // ── Sorted books (bug #2: newest sorts by created_at desc) ─────────────────
  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      if (sortBy === 'distance') return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [books, sortBy]);

  // ── Marker tap → preview card (spec §3.5) ──────────────────────────────────
  const handleMarkerPress = useCallback(
    (book: BookSearchResult) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedBook(buildPreviewBook(book, favoritesStore.isFavorited(book.id)));
      // Snap sheet to peek
      setSheetSnapIndex(DEFAULT_SNAP_INDEX);
    },
    [favoritesStore],
  );

  const handleClusterPress = useCallback(
    (cluster: ClusterPoint) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Find the first book in the cluster from the sheet data
      const firstBook = books.find((b) => cluster.book_ids.includes(b.id));
      if (firstBook) {
        setSelectedBook(buildPreviewBook(firstBook, favoritesStore.isFavorited(firstBook.id)));
      }
      setSheetSnapIndex(DEFAULT_SNAP_INDEX);
    },
    [books, favoritesStore],
  );

  const handleClosePreview = useCallback(() => {
    setSelectedBook(null);
  }, []);

  const handleNavigateToDetail = useCallback((bookId: string) => {
    setSelectedBook(null);
    router.push(`/book/${bookId}`);
  }, []);

  // ── Map press → close preview (spec §3.5.5) ────────────────────────────────
  const handleMapPress = useCallback(() => {
    if (selectedBook) setSelectedBook(null);
  }, [selectedBook]);

  // ── Long-press → map style picker (user preference) ───────────────────────
  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const labels = MAP_TYPES.map((t) => {
      if (t === 'standard') return 'Standart';
      if (t === 'satellite') return 'Uydu';
      if (t === 'hybrid') return 'Hibrit';
      return t;
    });
    Alert.alert(
      'Harita Stili',
      'Bir harita stili seçin',
      [
        ...labels.map((label, i) => ({
          text: mapTypeIndex === i ? `✓ ${label}` : label,
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setMapTypeIndex(i);
          },
        })),
        { text: 'İptal', style: 'cancel' },
      ],
    );
  }, [mapTypeIndex]);

  // ── Recenter on user + search around new location ──────────────────────────
  const recenterOnUser = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Get position: use cached userLocation if available, otherwise fetch fresh
    let lat: number;
    let lng: number;

    if (userLocation) {
      lat = userLocation.lat;
      lng = userLocation.lng;
    } else {
      toast.show('Konumunuz alınıyor...', { variant: 'info' });
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
        setUserLocation({ lat, lng });
      } catch (e) {
        toast.show('Konum alınamadı. GPS\'i kontrol edin.', { variant: 'error' });
        return;
      }
    }

    if (!mapRef.current) {
      toast.show('Harita hazır değil', { variant: 'error' });
      return;
    }

    const newRegion: Region = {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.15,
      longitudeDelta: 0.15,
    };
    // MapLibre Camera handles position via initialViewState/state
    setMapRegion(newRegion);
    setQueryBbox(regionToBbox(newRegion));
    lastQueriedCenterRef.current = { lat, lng };
    lastQueriedZoomRef.current = newRegion.latitudeDelta;
    setShowSearchPill(false);

    toast.show('Konumunuz aranıyor...', { variant: 'info' });

    // Force refetch (bypass React Query cache even if bbox values are same)
    try {
      await Promise.all([bboxQuery.refetch(), clustersQuery.refetch()]);
    } catch {
      // Individual query errors already have their own toasts (422 handling, etc.)
    }
    toast.show('Konum bulundu!', { variant: 'success' });
  }, [userLocation, bboxQuery, clustersQuery, toast]);

  // ── Cycle map type ─────────────────────────────────────────────────────────
  const cycleMapType = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMapTypeIndex((prev) => (prev + 1) % MAP_TYPES.length);
  }, []);

  // ── Region change: debounced state + drift pill (bugs #5, §3.7) ────────────
  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      // Bug #5: 300ms debounce on mapRegion state
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
      regionDebounceRef.current = setTimeout(() => {
        setMapRegion(region);
      }, REGION_DEBOUNCE_MS);

      // §3.7: 500ms debounce on pill visibility + 20% drift threshold.
      // Pill shows on EITHER center drift (pan) OR zoom change. Zoom-only
      // changes keep the same center, so without the zoom check the pill
      // never appears when the user zooms in → "can't get closer" bug.
      if (pillDebounceRef.current) clearTimeout(pillDebounceRef.current);
      pillDebounceRef.current = setTimeout(() => {
        if (lastQueriedCenterRef.current) {
          const dLat = Math.abs(region.latitude - lastQueriedCenterRef.current.lat);
          const dLng = Math.abs(region.longitude - lastQueriedCenterRef.current.lng);
          const centerDrifted =
            dLat > DRIFT_THRESHOLD * region.latitudeDelta ||
            dLng > DRIFT_THRESHOLD * region.longitudeDelta;
          const zoomDrifted =
            lastQueriedZoomRef.current != null &&
            Math.abs(region.latitudeDelta - lastQueriedZoomRef.current) /
              lastQueriedZoomRef.current >
              DRIFT_THRESHOLD;
          setShowSearchPill(centerDrifted || zoomDrifted);
        }
      }, PILL_DEBOUNCE_MS);
    },
    [],
  );

  // ── "Search this area" → re-query bbox (§3.7, §4.1) ────────────────────────
  const handleSearchArea = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const bbox = regionToBbox(mapRegion);
    setQueryBbox(bbox);
    lastQueriedCenterRef.current = { lat: mapRegion.latitude, lng: mapRegion.longitude };
    lastQueriedZoomRef.current = mapRegion.latitudeDelta;
    setShowSearchPill(false);
  }, [mapRegion]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const handleFilterPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilterVisible(true);
  }, []);

  const filterCount = [activeFilters.category, activeFilters.condition, activeFilters.language].filter(Boolean).length;

  // ── Chip select (with haptic) ──────────────────────────────────────────────
  const handleChipPress = useCallback((cat: BookCategory | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(selectedCategory === cat ? null : cat);
  }, [selectedCategory]);

  // ── Sort toggle (with haptic) ──────────────────────────────────────────────
  const handleSortToggle = useCallback((mode: 'distance' | 'newest') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSortBy(mode);
  }, []);

  // ── Radius chip → QuickRadiusSheet (§3.8, §4.5) ─────────────────────────────
  const handleRadiusLabelPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowRadiusSheet(true);
  }, []);

  const handleRadiusChange = useCallback(
    async (km: number) => {
      const prev = geofenceRadiusKm;
      setGeofenceRadiusKm(km); // optimistic
      try {
        await updateGeofenceRadius(km);
        toast.show('Bildirim alanı güncellendi', { variant: 'success' });
        queryClient.invalidateQueries({ queryKey: ['me'] });
      } catch {
        setGeofenceRadiusKm(prev); // revert
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show('Güncelleme başarısız', { variant: 'error' });
      }
    },
    [geofenceRadiusKm, toast, queryClient],
  );

  // ── Render singleton marker ────────────────────────────────────────────────
  const renderSingleton = useCallback(
    (book: BookSearchResult) => {
      if (!book.public_location) return null;
      const variant = getSingletonVariant(book);
      return (
        <BookMarker
          key={book.id}
          coordinate={{ latitude: book.public_location.lat, longitude: book.public_location.lng }}
          coverUrl={book.photos?.[0]?.url ?? null}
          thumbnailUrl={book.photos?.[0]?.thumbnail_url ?? null}
          title={book.title}
          onPress={() => handleMarkerPress(book)}
          variant={variant}
          selected={selectedBook?.id === book.id}
          category={book.category as BookCategory}
          distance={formatDistance(book.distance_km)}
          freshAgeHours={getFreshAgeHours(book)}
          latitudeDelta={mapRegion.latitudeDelta}
          isDark={isDark}
          testID={`marker-${book.id}`}
        />
      );
    },
    [handleMarkerPress, selectedBook?.id, mapRegion.latitudeDelta, isDark],
  );

  // ── Render shelf marker (from backend clusters) ────────────────────────────
  const renderShelf = useCallback(
    (cluster: ClusterPoint) => (
      <BookMarker
        key={`shelf-${cluster.centroid.lat}-${cluster.centroid.lng}`}
        coordinate={{ latitude: cluster.centroid.lat, longitude: cluster.centroid.lng }}
        coverUrl={cluster.front_cover_url}
        thumbnailUrl={cluster.front_thumbnail_url}
        title={cluster.front_title}
        onPress={() => handleClusterPress(cluster)}
        variant="shelf"
        selected={false}
        category={(cluster.categories[0] as BookCategory) ?? 'other'}
        stackCount={cluster.count - 1}
        isDark={isDark}
        testID={`shelf-${cluster.centroid.lat}`}
      />
    ),
    [handleClusterPress, isDark],
  );

  // ── Mini card (peek mode) ──────────────────────────────────────────────────
  const renderMiniCard = useCallback(
    ({ item }: { item: BookSearchResult }) => {
      const coverUrl = item.photos?.[0]?.thumbnail_url ?? item.photos?.[0]?.url;
      return (
        <TouchableOpacity
          style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => handleMarkerPress(item)}
          testID={`mini-card-${item.id}`}
        >
          <View style={[styles.miniCardCover, { backgroundColor: colors.surfaceAlt }]}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={styles.miniCardCoverImg} resizeMode="cover" />
            ) : (
              <View style={styles.miniCardPlaceholder}>
                <Text style={[styles.miniCardPlaceholderText, { color: colors.textMuted }]}>
                  {item.title.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.miniCardInfo}>
            <Text style={[styles.miniCardTitle, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.miniCardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
              {item.author ?? ''}
            </Text>
            <View style={styles.miniCardMeta}>
              <View style={[styles.miniCardDistBadge, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.miniCardDistText, { color: colors.primary }]}>
                  {formatDistance(item.distance_km)}
                </Text>
              </View>
              <Text style={[styles.miniCardCond, { color: colors.textMuted }]}>
                {item.condition}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colors, handleMarkerPress],
  );

  // ── List card (half/full mode) ─────────────────────────────────────────────
  const renderListCard = useCallback(
    ({ item }: { item: BookSearchResult }) => (
      <BookCard
        key={item.id}
        title={item.title}
        author={item.author ?? ''}
        condition={item.condition as any}
        category={item.category}
        distanceKm={item.distance_km}
        coverUrl={item.photos?.[0]?.url}
        onPress={() => router.push(`/book/${item.id}`)}
        onFavorite={() => {
          if (favoritesStore.isFavorited(item.id)) {
            favoritesStore.removeFavorite(item.id);
          } else {
            favoritesStore.addFavorite({
              bookId: item.id,
              title: item.title,
              coverUrl: item.photos?.[0]?.url,
              ownerId: item.owner_id,
              addedAt: new Date().toISOString(),
            });
          }
        }}
        testID={`book-card-${item.id}`}
      />
    ),
    [favoritesStore],
  );

  // ── Sheet header (bug #6: count booksWithLocation) ─────────────────────────
  // "50+" indicator: when the raw API response hits BBOX_LIMIT, the count is
  // capped — there may be more books in the viewport. The "+" signals "zoom in
  // to see the real count for a smaller area."
  const countCapped = books.length >= BBOX_LIMIT;
  const sheetHeader = useMemo(
    () => (
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetResultCount, { color: colors.text }]}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>
            {booksWithLocation.length}{countCapped ? '+' : ''}
          </Text>
          {' '}kitap bulundu
        </Text>
        <View style={styles.sheetSortPills}>
          <TouchableOpacity
            style={[
              styles.sortPill,
              { backgroundColor: sortBy === 'distance' ? colors.primary : colors.surfaceAlt },
            ]}
            onPress={() => handleSortToggle('distance')}
            testID="sort-distance"
          >
            <Text style={[styles.sortPillText, { color: sortBy === 'distance' ? '#FFFFFF' : colors.textMuted }]}>
              Yakınlık
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.sortPill,
              { backgroundColor: sortBy === 'newest' ? colors.primary : colors.surfaceAlt },
            ]}
            onPress={() => handleSortToggle('newest')}
            testID="sort-newest"
          >
            <Text style={[styles.sortPillText, { color: sortBy === 'newest' ? '#FFFFFF' : colors.textMuted }]}>
              En Yeni
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [booksWithLocation.length, countCapped, colors, sortBy, handleSortToggle],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Map (fills the screen, spec §3.1) ──────────────────────────────── */}
      {MAPLIBRE_AVAILABLE && MLMap ? (
        <MLMap
          ref={mapRef}
          style={styles.map}
          logo={false}
          attribution={false}
          mapStyle={MAP_STYLE}
          onRegionDidChange={(event: any) => {
            const geo = event.geometry;
            if (geo) {
              const [lng, lat] = geo.coordinates;
              const zoom = event.properties?.zoom ?? 12;
              const delta = 360 / Math.pow(2, zoom);
              setMapRegion({
                latitude: lat,
                longitude: lng,
                latitudeDelta: delta,
                longitudeDelta: delta,
              });
            }
          }}
          onPress={() => {
            handleMapPress();
          }}
          testID="map-view"
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: [mapRegion.longitude, mapRegion.latitude],
              zoom: deltaToZoom(mapRegion.latitudeDelta),
            }}
          />
          {/* ── Individual book markers (singletons) ─────────────────────────── */}
          {markerBooks.map((book) => {
            if (!book.public_location) return null;
            return renderSingleton(book);
          })}

          {/* Shelf markers from backend clusters (30m grouping, §3.4 shelf variant) */}
          {clusters.map((cluster) => (
            renderShelf(cluster)
          ))}

          {/* Radius circle (geofence visualization, §3.8) */}
          {userLocation && (
            <RadiusCircle
              center={userLocation}
              radiusKm={geofenceRadiusKm}
              color={colors.primary}
              onLabelPress={handleRadiusLabelPress}
              testID="radius-circle"
            />
          )}

          {/* User location dot with accuracy + pulse (§3.4) */}
          {userLocation && (
            <UserLocationDot coordinate={userLocation} color={colors.primary} testID="user-dot" />
          )}
        </MLMap>
      ) : (
        /* Fallback when MapLibre native module is unavailable (Expo Go) */
        <View style={[styles.map, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="map-outline" size={48} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, marginTop: 12, fontSize: 14, textAlign: 'center' }}>
            Harita goruntusu icin{'\n'}Development Build gereklidir
          </Text>
        </View>
      )}

      {/* ── Error overlay when bbox query fails (network/server error, bug H13) ── */}
      {bboxQuery.isError && (
        <View style={styles.errorOverlay} pointerEvents="auto" testID="bbox-error">
          <Ionicons name="cloud-offline-outline" size={48} color="#FFFFFF" style={{ marginBottom: 12 }} />
          <Text style={styles.errorTitle}>Kitaplar yüklenemedi</Text>
          <Text style={styles.errorMessage}>İnternet bağlantınızı kontrol edin.</Text>
          <TouchableOpacity
            style={styles.errorRetryBtn}
            onPress={() => bboxQuery.refetch()}
            testID="bbox-error-retry"
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.errorRetryText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Dimming overlay when a marker is selected (§3.4) ─────────────────── */}
      {selectedBook && (
        <View style={[styles.dimOverlay, { backgroundColor: isDark ? 'rgba(15,12,9,0.35)' : 'rgba(42,39,34,0.25)' }]} pointerEvents="none" testID="dim-overlay" />
      )}

      {/* ── Floating overlay (pointerEvents box-none, §3.1) ──────────────────── */}
      <View style={styles.floatingOverlay} pointerEvents="box-none">
        {/* Search bar + chips (glassmorphism, §3.11) */}
        <View style={[styles.floatingSearch, { paddingTop: insets.top + spacing.sm }]}>
          {/* Search row: search bar (with green camera) + separate filter button */}
          <View style={styles.searchRow}>
            {/* Search bar — vision: rgba(255,255,255,0.92), borderRadius 22, height 44 */}
            <View style={[styles.searchBarBlur, { backgroundColor: isDark ? 'rgba(33,31,26,0.90)' : 'rgba(255,255,255,0.92)' }]}>
              <View style={styles.searchBarInner}>
                <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                <TextInput
                  style={[styles.searchInput, { color: colors.text }]}
                  placeholder="Kitap veya yazar ara..."
                  placeholderTextColor={colors.textMuted}
                  value={searchText}
                  onChangeText={setSearchText}
                  testID="search-input"
                />
                {/* Green circle camera button (vision: 22px, #11806B bg, white icon) */}
                <TouchableOpacity
                  onPress={() => router.push('/book/scan-isbn')}
                  style={[styles.cameraCircle, { backgroundColor: colors.primary }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID="search-camera"
                >
                  <Ionicons name="camera" size={13} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Separate filter button — vision: 44×44, rgba(255,255,255,0.92), 3-lines icon */}
            <TouchableOpacity
              onPress={handleFilterPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="search-filter"
            >
              <View style={[styles.filterBtn, { backgroundColor: isDark ? 'rgba(33,31,26,0.90)' : 'rgba(255,255,255,0.92)' }]}>
                <Ionicons name="options" size={20} color={colors.primary} />
                {filterCount > 0 && (
                  <View style={styles.filterBadge} testID="search-filter-badge">
                    <Text style={styles.filterBadgeText}>{filterCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>

          {/* Chip row — vision: rgba(255,255,255,0.92), active chip solid #11806B */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
            contentContainerStyle={styles.chipContent}
            testID="chip-row"
          >
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat.value;
              const dotColor = cat.value ? categoryColor(cat.value, isDark) : colors.primary;
              return (
                <TouchableOpacity
                  key={cat.label}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isActive
                        ? colors.primary
                        : isDark ? 'rgba(33,31,26,0.88)' : 'rgba(255,255,255,0.92)',
                    },
                  ]}
                  onPress={() => handleChipPress(cat.value)}
                  testID={`chip-${cat.label}`}
                >
                  <View style={[styles.chipDot, { backgroundColor: isActive ? '#FFFFFF' : dotColor }]} />
                  <Text style={[styles.chipText, { color: isActive ? '#FFFFFF' : colors.text }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* "Search this area" pill (§3.7) */}
        {showSearchPill && (
          <SearchAreaPill
            onPress={handleSearchArea}
            peekHeightPx={SHEET_PEEK_PX}
            insetsBottom={insets.bottom}
          />
        )}

        {/* Right floating controls (§3.6) */}
        <RightControls
          onRecenter={recenterOnUser}
          onFilter={handleFilterPress}
          onCycleMapType={cycleMapType}
          filterCount={filterCount}
          insets={insets}
          peekHeightPx={SHEET_PEEK_PX}
          colors={colors}
          isDark={isDark}
        />
      </View>

      {/* ── Marker preview card (§3.5, z:40) ─────────────────────────────────── */}
      {selectedBook && (
        <MarkerPreviewCard
          book={selectedBook}
          onClose={handleClosePreview}
          onNavigateToDetail={handleNavigateToDetail}
          peekHeightPx={SHEET_PEEK_PX}
          insetsBottom={insets.bottom}
          colors={colors}
          isDark={isDark}
        />
      )}

      {/* ── Bottom sheet (§3.3, z:30) ────────────────────────────────────────── */}
      <BookBottomSheet
        snapIndex={sheetSnapIndex}
        onSnapChange={setSheetSnapIndex}
        data={sortedBooks as BookSearchResult[]}
        renderMiniCard={renderMiniCard}
        renderListCard={renderListCard}
        header={sheetHeader}
        keyExtractor={(item: BookSearchResult) => item.id}
        isDark={isDark}
      />

      {/* ── Filter sheet ──────────────────────────────────────────────────────── */}
      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        onApply={(filters) => {
          setActiveFilters(filters);
          setFilterVisible(false);
        }}
        resultCount={booksWithLocation.length}
        initialFilters={activeFilters}
      />

      {/* ── Quick radius sheet (from map chip, §4.5) ──────────────────────────── */}
      <Modal
        visible={showRadiusSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRadiusSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <QuickRadiusSheet
              currentRadiusKm={geofenceRadiusKm}
              onRadiusChange={handleRadiusChange}
              onClose={() => setShowRadiusSheet(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },

  // Error overlay (bug H13: network failure / server error)
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.xl,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: fontSize.title,
    fontWeight: '800',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  errorMessage: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  errorRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  errorRetryText: {
    color: '#FFFFFF',
    fontSize: fontSize.body,
    fontWeight: '700',
  },

  // Dimming overlay (§3.4 selection state)
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },

  // Floating overlay (§3.1 pointerEvents box-none)
  floatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  floatingSearch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.xs,
  },

  // Search bar (glassmorphism)
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  searchBarBlur: {
    flex: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadows.float,
  },
  searchBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 44,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.bodySm,
  },
  // Green circle camera button (vision: 22px, #11806B bg)
  cameraCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Separate filter button (vision: 44×44, blur, 3-lines icon)
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
    marginLeft: spacing.sm,
    ...shadows.float,
  },
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F2766B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingHorizontal: 3,
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },

  // Chip row (glassmorphism)
  chipRow: {
    maxHeight: 44,
    marginBottom: spacing.xs,
  },
  chipContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
    ...shadows.card,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },

  // Sheet header (bug #6: count booksWithLocation)
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  sheetResultCount: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  sheetSortPills: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sortPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  sortPillText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },

  // Mini card (peek mode)
  miniCard: {
    width: 220,
    flexDirection: 'row',
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: spacing.sm,
    borderWidth: 1,
    ...shadows.card,
  },
  miniCardCover: {
    width: 48,
    height: 64,
    borderRadius: radius.input,
    overflow: 'hidden',
  },
  miniCardCoverImg: {
    width: 48,
    height: 64,
  },
  miniCardPlaceholder: {
    width: 48,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniCardPlaceholderText: {
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  miniCardInfo: {
    flex: 1,
  },
  miniCardTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  miniCardAuthor: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  miniCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  miniCardDistBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  miniCardDistText: {
    fontSize: 11,
    fontWeight: '700',
  },
  miniCardCond: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Supercluster bubble
  clusterBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6 },
      android: { elevation: 8 },
    }),
  },
  clusterText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  // Modal overlay (QuickRadiusSheet)
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
});
