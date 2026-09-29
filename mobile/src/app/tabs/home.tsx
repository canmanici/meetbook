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
 *   - Long-press map → map style picker (Standart / Uydu / Hibrit)
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
  Modal,
  Dimensions,
  useColorScheme,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { crashReporter } from '@/lib/crash-reporter';
import {
  Camera,
  type Region,
  MAPLIBRE_AVAILABLE,
  MLMap,
  MLGeoJSONSource,
  HeatmapLayer,
  MAP_STYLE,
} from '@/lib/map-adapter';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui/tokens';
import { BookCard, BookCover, EmptyState, FilterSheet, type FilterState } from '@/components/ui';
import { BookMarker, categoryColor, type BookCategory, type MarkerVariant } from '@/components/ui/book-marker';
import {
  searchBboxBooks,
  searchNearbyBooks,
  getBookClusters,
  getMe,
  updateGeofenceRadius,
  listNotifications,
  type BBoxParams,
  type BookSearchResult,
  type ClusterPoint,
} from '@/lib/api/client';
import { useFavoritesStore } from '@/stores/favorites';
import { useToast } from '@/hooks/use-toast';
import { useShadowBlocked } from '@/hooks/use-shadow-blocked';
import BookBottomSheet, { DEFAULT_SNAP_INDEX } from '@/components/map/book-bottom-sheet';
import MarkerPreviewCard, { type PreviewBook } from '@/components/map/marker-preview-card';
import { RightControls } from '@/components/map/right-controls';
import { SearchAreaPill } from '@/components/map/search-area-pill';
import { RadiusCircle } from '@/components/map/radius-circle';
import { UserLocationDot } from '@/components/map/user-location-dot';
import QuickRadiusSheet from '@/components/map/quick-radius-sheet';
// Lazy getter for expo-notifications — module-level require() triggers an
// ERROR overlay in Expo Go (SDK 53+) even inside try-catch.  Loading on first
// use avoids the problem entirely.
let _Notifications: typeof import('expo-notifications') | null = null;
let _notifLoadAttempted = false;
function getNotifications(): typeof import('expo-notifications') | null {
  if (_notifLoadAttempted) return _Notifications;
  _notifLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require avoids expo-notifications Expo Go error overlay
    _Notifications = require('expo-notifications');
  } catch {
    // Expected in Expo Go — no native module.
  }
  return _Notifications;
}
// Lazy import — push-tokens uses expo-notifications which crashes
// Expo Go. Dynamic import avoids module-level failure.
const lazyRegisterPushToken = (): Promise<boolean> =>
  import('@/lib/push-tokens').then((m) => m.registerPushToken());

// ── Safe array map (crash guard + reporter) ─────────────────────────────────
// If `arr` is unexpectedly undefined/falsy, we log the full context to crashReporter
// (so the bug is findable in the logs) AND fall back to [] so the app doesn't crash.
// Once we identify the root cause, this guard goes away.
function safeMap<T, U>(arr: T[] | undefined | null, fn: (item: T, index: number) => U, label: string): U[] {
  if (!arr) {
    const err = new Error(`[Home] safeMap('${label}'): array is ${typeof arr}`);
    console.error(err.message, { arr });
    crashReporter.captureError(err, `safeMap_${label}`);
    return [];
  }
  return arr.map(fn);
}

// ── Constants ──────────────────────────────────────────────────────────────

const WINDOW_H = Dimensions.get('window').height;
const SHEET_PEEK_PX = Math.round(WINDOW_H * 0.18);

const CATEGORIES: { value: BookCategory | null; label: string }[] = [
  { value: null, label: 'Tümü' },
  { value: 'fiction', label: 'Roman' },
  { value: 'non_fiction', label: 'Bilim' },
  { value: 'textbook', label: 'Ders' },
  { value: 'comics', label: 'Çizgi' },
  { value: 'children', label: 'Çocuk' },
  { value: 'poetry', label: 'Şiir' },
  { value: 'other', label: 'Diğer' },
];

const MAP_TYPES: ('standard' | 'satellite' | 'hybrid')[] = ['standard', 'satellite', 'hybrid'];

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
// F12: recency indicator — 1-7 day window ("Bu hafta" blue dot).
const RECENCY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REGION_DEBOUNCE_MS = 300;
// Hard cap on the bbox search (backend /books/search-bbox enforces le=50).
// When the response hits this cap the count is "50+" — there may be more books
// in the viewport than we fetched. Zooming in re-queries a smaller bbox and
// reveals the true count for that area.
const BBOX_LIMIT = 50;
// Zoom level at which a shelf (same-address cluster) "spiderfies" into its
// individual book pins, spaced out around the shared point, instead of
// staying collapsed as one +N marker. Below this zoom they'd overlap too
// much to be tappable, so they stay merged.
const SPIDERFY_ZOOM = 17;
// Spread radius (degrees) for spiderfied pins — small enough to still read
// as "the same spot" but wide enough apart to tap individually at zoom 17+.
const SPIDERFY_RADIUS_DEG = 0.00012;

function spiderfyOffset(
  centroid: { lat: number; lng: number },
  index: number,
  total: number,
): { latitude: number; longitude: number } {
  const angle = (2 * Math.PI * index) / total;
  const latOffset = SPIDERFY_RADIUS_DEG * Math.sin(angle);
  const lngOffset =
    (SPIDERFY_RADIUS_DEG * Math.cos(angle)) / Math.cos((centroid.lat * Math.PI) / 180);
  return { latitude: centroid.lat + latOffset, longitude: centroid.lng + lngOffset };
}
const SAVED_SEARCHES_KEY = 'meetbook-saved-searches';
// F11: AsyncStorage key for the last map viewport (lat/lng/zoom deltas).
const SAVED_MAP_REGION_KEY = 'saved_map_region';

// ── Helpers ────────────────────────────────────────────────────────────────

function regionToBbox(region: Region): BBoxParams {
  return {
    min_lat: region.latitude - region.latitudeDelta / 2,
    max_lat: region.latitude + region.latitudeDelta / 2,
    min_lng: region.longitude - region.longitudeDelta / 2,
    max_lng: region.longitude + region.longitudeDelta / 2,
  };
}

// Backend /books/search-bbox and /books/clusters reject spans wider than
// 0.45° lat / 0.6° lng. Stay just inside so a clamped radius bbox never 422s.
const MAX_BBOX_LAT_SPAN = 0.44;
const MAX_BBOX_LNG_SPAN = 0.59;
const SEARCH_DEBOUNCE_MS = 350;
// Show "Bu alanı ara" once the viewport center moved this fraction of the
// queried span, or the zoom changed by more than this factor.
const PILL_PAN_FRACTION = 0.25;
const PILL_ZOOM_FACTOR = 1.6;

/** Bbox enclosing a radius circle, clamped to the backend's max span. */
function radiusToBbox(center: { lat: number; lng: number }, radiusKm: number): BBoxParams {
  const cosLat = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const halfLat = Math.min(radiusKm / 111, MAX_BBOX_LAT_SPAN / 2);
  const halfLng = Math.min(radiusKm / (111 * cosLat), MAX_BBOX_LNG_SPAN / 2);
  return {
    min_lat: center.lat - halfLat,
    max_lat: center.lat + halfLat,
    min_lng: center.lng - halfLng,
    max_lng: center.lng + halfLng,
  };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function deltaToZoom(delta: number): number {
  return Math.max(0, Math.min(20, Math.log2(360 / delta)));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function getSingletonVariant(book: MapBook): MarkerVariant {
  if (!book.is_available) return 'unavailable';
  if (Date.now() - new Date(book.created_at).getTime() < FRESH_WINDOW_MS) return 'fresh';
  if (book.category === 'textbook') return 'textbook';
  return 'standard';
}

function getFreshAgeHours(book: MapBook): number | undefined {
  const ageMs = Date.now() - new Date(book.created_at).getTime();
  if (ageMs < FRESH_WINDOW_MS) {
    return Math.max(1, Math.floor(ageMs / (60 * 60 * 1000)));
  }
  return undefined;
}

// F12: recency indicator for book cards/previews.
//   <24h   → "Yeni"      (green dot, colors.success)
//   1-7 gün → "Bu hafta"  (blue dot, colors.info)
//   7+ gün  → null (no indicator — stale listings render normally)
// Only shown on individual book cards/previews, never on cluster/shelf markers.
type RecencyColorKey = 'success' | 'info';
interface RecencyIndicator {
  label: string;
  colorKey: RecencyColorKey;
}
function getRecency(book: BookSearchResult): RecencyIndicator | null {
  const ageMs = Date.now() - new Date(book.created_at).getTime();
  if (ageMs < FRESH_WINDOW_MS) return { label: 'Yeni', colorKey: 'success' };
  if (ageMs < RECENCY_WEEK_MS) return { label: 'Bu hafta', colorKey: 'info' };
  return null;
}

// F11: persist the last map viewport to AsyncStorage so the next launch
// resumes where the user left off. AsyncStorage may be unavailable in Expo Go
// — failures are swallowed (non-fatal).
async function saveMapRegion(region: Region) {
  try {
    await AsyncStorage.setItem(
      SAVED_MAP_REGION_KEY,
      JSON.stringify({
        latitude: region.latitude,
        longitude: region.longitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      }),
    );
  } catch {}
}

// Radius search and map-area (bbox) search return slightly different shapes —
// only the radius results carry the optional `owner` summary.
type MapBook =
  | BookSearchResult
  | Awaited<ReturnType<typeof searchNearbyBooks>>['items'][number];

function buildPreviewBook(book: MapBook, isFavorited: boolean): PreviewBook {
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
  const [mapTypeIndex, setMapTypeIndex] = useState(0);

  // MapLibre needs a GL style URL/JSON — not Google Maps' featureType/stylers
  // format. Derive the MapTiler style from the active map type (eye button)
  // and dark mode. Standard → streets-v2 (dark variant in dark mode);
  // satellite/hybrid use MapTiler's imagery styles.
  const mapStyle = (() => {
    const base = MAP_TYPES[mapTypeIndex];
    if (base === 'satellite') return MAP_STYLE.replace('streets-v2', 'satellite');
    if (base === 'hybrid') return MAP_STYLE.replace('streets-v2', 'hybrid');
    return isDark ? MAP_STYLE.replace('streets-v2', 'streets-v2-dark') : MAP_STYLE;
  })();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const favoritesStore = useFavoritesStore();
  const { shadowBlocked, reload: reloadShadowBlocked } = useShadowBlocked();

  // Shadow-blocked list is local (AsyncStorage); refresh on focus so books
  // from newly shadow-blocked users are hidden when returning from a chat.
  useFocusEffect(
    useCallback(() => {
      reloadShadowBlocked();
    }, [reloadShadowBlocked]),
  );

  // ── State ──────────────────────────────────────────────────────────────────
  // Real GPS fix only — never a made-up fallback (that drew a fake "you are
  // here" dot in Istanbul and measured every distance from it).
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [queryBbox, setQueryBbox] = useState<BBoxParams | null>(null);
  // 'radius' = books around the user (default with GPS); 'area' = the map
  // viewport the user explicitly searched ("Bu alanı ara", or no GPS).
  // List AND markers always come from the same mode.
  const [searchMode, setSearchMode] = useState<'radius' | 'area'>('area');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedBook, setSelectedBook] = useState<PreviewBook | null>(null);
  const [showSearchPill, setShowSearchPill] = useState(false);
  const [sheetSnapIndex, setSheetSnapIndex] = useState(DEFAULT_SNAP_INDEX);
  const [sortBy, setSortBy] = useState<'distance' | 'newest'>('distance');
  const [filterVisible, setFilterVisible] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
  });
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 41.0082,
    longitude: 28.9784,
    latitudeDelta: 0.15,
    longitudeDelta: 0.15,
  });
  const [showRadiusSheet, setShowRadiusSheet] = useState(false);
  const [geofenceRadiusKm, setGeofenceRadiusKm] = useState(10);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [showHeatmap] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastQueriedCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track the last queried latitudeDelta so we can detect ZOOM changes (not
  // just pan). Without this, zooming in keeps the same center → the drift
  // pill never shows → the user can't re-query the tighter viewport →
  // "can't get closer" bug.
  const lastQueriedZoomRef = useRef<number | null>(null);
  // F11: whether a saved map viewport was restored this launch (skip fly-to-user).
  const hasSavedRegionRef = useRef(false);
  // F11: debounce ref for persisting the map viewport to AsyncStorage.
  const regionSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Location + initial bbox ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // F11: restore the last saved map viewport (lat/lng/zoom) if present so
      // the user resumes where they left off. Falls back to the user's GPS.
      let savedRegion: Region | null = null;
      try {
        const raw = await AsyncStorage.getItem(SAVED_MAP_REGION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            typeof parsed?.latitude === 'number' &&
            typeof parsed?.longitude === 'number' &&
            typeof parsed?.latitudeDelta === 'number' &&
            typeof parsed?.longitudeDelta === 'number'
          ) {
            savedRegion = parsed as Region;
          }
        }
      } catch {
        // AsyncStorage unavailable (Expo Go) — non-fatal
      }
      hasSavedRegionRef.current = savedRegion !== null;

      let gps: { lat: number; lng: number } | null = null;
      try {
        // Check before asking: a request always starts Android's permission
        // activity (even when already granted), which flashed over the call
        // screen when the app was cold-started by an incoming call.
        const current = await Location.getForegroundPermissionsAsync?.().catch(() => null);
        const status =
          current?.status === 'granted'
            ? 'granted'
            : (await Location.requestForegroundPermissionsAsync()).status;
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          gps = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      } catch {
        // GPS off / timed out — browse by map area instead.
      }
      setUserLocation(gps);
      // Use the saved viewport when available; otherwise center on the user
      // (or Istanbul as a neutral starting view — NOT as a fake location).
      const initialRegion: Region = savedRegion ?? {
        latitude: gps?.lat ?? 41.0082,
        longitude: gps?.lng ?? 28.9784,
        latitudeDelta: 0.15,
        longitudeDelta: 0.15,
      };
      setMapRegion(initialRegion);
      setSearchMode(gps ? 'radius' : 'area');
      setQueryBbox(regionToBbox(initialRegion));
      lastQueriedCenterRef.current = { lat: initialRegion.latitude, lng: initialRegion.longitude };
      lastQueriedZoomRef.current = initialRegion.latitudeDelta;
    })();
  }, []);

  // ── Push permission banner (first launch only) ─────────────────────────────
  useEffect(() => {
    // Expo Go: AsyncStorage unavailable, .catch() to prevent crash
    AsyncStorage.getItem('hasAskedPushPermission')
      .then((asked) => {
        if (!asked) setShowPushBanner(true);
      })
      .catch(() => {});
  }, []);

  const requestPushPermission = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!getNotifications()) {
      await AsyncStorage.setItem('hasAskedPushPermission', 'true').catch(() => {});
      setShowPushBanner(false);
      return;
    }
    try {
      await lazyRegisterPushToken();
    } catch {}
    await AsyncStorage.setItem('hasAskedPushPermission', 'true').catch(() => {});
    setShowPushBanner(false);
  }, []);

  const dismissPushBanner = useCallback(async () => {
    await AsyncStorage.setItem('hasAskedPushPermission', 'true').catch(() => {});
    setShowPushBanner(false);
  }, []);

  // ── Fly camera to user location once GPS resolves ──────────────────────────
  const hasFlownToLocation = useRef(false);
  useEffect(() => {
    if (userLocation && cameraRef.current && !hasFlownToLocation.current) {
      hasFlownToLocation.current = true;
      // F11: don't yank the camera to the user's location when we just restored
      // a saved viewport — let the user resume where they left off.
      if (hasSavedRegionRef.current) return;
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

  // ── Notifications (unread badge on home bell) ──────────────────────────────
  const { data: notificationsData } = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    staleTime: 30_000,
  });
  const unreadCount = useMemo(
    () => (notificationsData?.items ?? []).filter((n) => !n.read_at).length,
    [notificationsData],
  );

  // Seed the radius from the profile ONCE — a later `me` refetch must not
  // overwrite a radius the user just picked.
  const radiusSeededRef = useRef(false);
  useEffect(() => {
    const r = (meData as any)?.geofence_radius_km;
    if (!radiusSeededRef.current && typeof r === 'number' && r >= 1 && r <= 200) {
      radiusSeededRef.current = true;
      setGeofenceRadiusKm(r);
    }
  }, [meData]);

  // Debounce + trim the search box: every keystroke used to fire two
  // requests and blank the list; whitespace-only input matched nothing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText]);

  // ── Search: one mode feeds BOTH the sheet list and the markers ──────────
  const filterCategory = activeFilters.category ?? undefined;
  const q = debouncedSearch || undefined;
  const origin = userLocation ? { origin_lat: userLocation.lat, origin_lng: userLocation.lng } : {};
  const useRadiusMode = searchMode === 'radius' && !!userLocation;

  // Markers/clusters bbox: the radius circle's bbox in radius mode (clamped
  // to the backend's max span), the searched viewport in area mode.
  const markerBbox = useMemo<BBoxParams | null>(
    () => (useRadiusMode && userLocation ? radiusToBbox(userLocation, geofenceRadiusKm) : queryBbox),
    [useRadiusMode, userLocation, geofenceRadiusKm, queryBbox],
  );

  const radiusQuery = useQuery({
    queryKey: ['books', 'radius', userLocation, geofenceRadiusKm, filterCategory, q, activeFilters.condition, activeFilters.language],
    queryFn: () =>
      searchNearbyBooks({
        lat: userLocation!.lat,
        lng: userLocation!.lng,
        radius_km: geofenceRadiusKm,
        category: filterCategory,
        condition: activeFilters.condition ?? undefined,
        language: activeFilters.language ?? undefined,
        q,
        limit: BBOX_LIMIT,
      }),
    enabled: useRadiusMode,
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const bboxQuery = useQuery({
    queryKey: ['books', 'bbox', queryBbox, filterCategory, q, activeFilters.condition, activeFilters.language, userLocation],
    queryFn: async () => {
      try {
        return await searchBboxBooks({
          ...(queryBbox as BBoxParams),
          category: filterCategory,
          condition: activeFilters.condition ?? undefined,
          language: activeFilters.language ?? undefined,
          q,
          limit: BBOX_LIMIT,
          ...origin,
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
    enabled: !useRadiusMode && !!queryBbox,
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const activeListQuery = useRadiusMode ? radiusQuery : bboxQuery;
  const rawBooks = useMemo(
    () => (activeListQuery.data?.items ?? []) as MapBook[],
    [activeListQuery.data],
  );
  const isLoading = activeListQuery.isLoading;

  // F19: Shadow block — hide books owned by shadow-blocked users so their
  // content is silently filtered from the blocker's home/search results.
  const isBlockedOwner = useMemo(() => {
    const blocked = new Set(shadowBlocked);
    return (ownerId: string) => blocked.has(ownerId);
  }, [shadowBlocked]);
  const books = useMemo(
    () => (shadowBlocked.length === 0 ? rawBooks : rawBooks.filter((b) => !isBlockedOwner(b.owner_id))),
    [rawBooks, shadowBlocked.length, isBlockedOwner],
  );

  // In radius mode the marker bbox is a square around the circle — drop the
  // corners so markers show exactly the books the list is about.
  const inSearchArea = useCallback(
    (p: { lat: number; lng: number }) =>
      !useRadiusMode || !userLocation || distanceKm(userLocation, p) <= geofenceRadiusKm,
    [useRadiusMode, userLocation, geofenceRadiusKm],
  );

  // ── Clusters (shelf markers + singletons) over the same search area ─────
  const clustersQuery = useQuery({
    queryKey: ['books', 'clusters', markerBbox, filterCategory, q, activeFilters.condition, activeFilters.language, userLocation],
    queryFn: () =>
      getBookClusters({
        ...(markerBbox as BBoxParams),
        category: filterCategory,
        condition: activeFilters.condition ?? undefined,
        language: activeFilters.language ?? undefined,
        q,
        ...origin,
      }),
    enabled: !!markerBbox,
    staleTime: 60_000,
    retry: 0, // don't retry — if it fails, we fall back to list books for markers
    placeholderData: keepPreviousData,
  });
  const clusters = useMemo(
    () =>
      (clustersQuery.data?.clusters ?? [])
        .filter((c) => inSearchArea(c.centroid))
        .map((c) => (c.books ? { ...c, books: c.books.filter((b) => !isBlockedOwner(b.owner_id)) } : c))
        // A shelf whose every book is hidden must not render as an empty +N.
        .filter((c) => c.books === undefined || c.books.length > 0),
    [clustersQuery.data, inSearchArea, isBlockedOwner],
  );
  // F19: filter shadow-blocked owners from singleton markers too.
  const clustersSingletons = useMemo(
    () =>
      (clustersQuery.data?.singletons ?? []).filter(
        (b) => !isBlockedOwner(b.owner_id) && (!b.public_location || inSearchArea(b.public_location)),
      ),
    [clustersQuery.data, isBlockedOwner, inSearchArea],
  );
  const clustersSucceeded = clustersQuery.isSuccess && clustersQuery.data !== undefined;

  // Markers: use clusters singletons when the clusters query succeeded (even
  // if it legitimately returns zero singletons, e.g. every book on screen is
  // clustered into a shelf). Only fall back to the raw bbox books when the
  // clusters endpoint itself failed, so co-located books don't get rendered
  // as overlapping singleton markers instead of a shelf marker.
  const markerBooks = useMemo(
    () => (clustersSucceeded ? clustersSingletons : books),
    [clustersSucceeded, clustersSingletons, books],
  );

  // ── Heatmap source data (book density, §toggle) ────────────────────────────
  // Builds a GeoJSON FeatureCollection of Points from singleton markers +
  // backend cluster centroids. Cluster points carry a `weight` equal to the
  // cluster count so dense shelves contribute more to the heatmap.
  const heatmapGeoJSON = useMemo(() => {
    const features: {
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { weight: number };
    }[] = [];
    for (const book of markerBooks) {
      const loc = book.public_location;
      if (loc && loc.lat != null && loc.lng != null) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
          properties: { weight: 1 },
        });
      }
    }
    for (const cluster of clusters) {
      const c = cluster.centroid;
      if (c && c.lat != null && c.lng != null) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
          properties: { weight: cluster.count },
        });
      }
    }
    return { type: 'FeatureCollection' as const, features };
  }, [markerBooks, clusters]);

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

  const showSkeletons = isLoading || (activeListQuery.isFetching && books.length === 0);

  // ── Marker tap → preview card (spec §3.5) ──────────────────────────────────
  const handleMarkerPress = useCallback(
    (book: MapBook) => {
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
      // The shelf carries its own member books — they need not be in the
      // (limited) list query at all.
      const firstBook =
        cluster.books?.[0] ?? books.find((b) => cluster.book_ids.includes(b.id));
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

  // ── Recenter on user + search around new location ──────────────────────────
  const recenterOnUser = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Always take a fresh fix — the user may have moved since the last one.
    let lat: number;
    let lng: number;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('permission');
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      lat = loc.coords.latitude;
      lng = loc.coords.longitude;
      setUserLocation({ lat, lng });
    } catch {
      if (!userLocation) {
        toast.show('Konum alınamadı. GPS\'i ve konum iznini kontrol edin.', { variant: 'error' });
        return;
      }
      lat = userLocation.lat;
      lng = userLocation.lng;
    }

    if (!cameraRef.current) {
      toast.show('Harita hazır değil', { variant: 'error' });
      return;
    }

    // Fly camera to user's location — MapLibre Camera is NOT controlled by
    // React state after initial render; must call flyTo() on the ref.
    cameraRef.current.flyTo({
      center: [lng, lat],
      zoom: deltaToZoom(0.15),
      duration: 1000,
    });

    const newRegion: Region = {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.15,
      longitudeDelta: 0.15,
    };
    setMapRegion(newRegion);
    setQueryBbox(regionToBbox(newRegion));
    // Back to "around me": list + markers follow the (new) location; the
    // queries refetch on their own because the location is in their keys.
    setSearchMode('radius');
    lastQueriedCenterRef.current = { lat, lng };
    lastQueriedZoomRef.current = newRegion.latitudeDelta;
    setShowSearchPill(false);
  }, [userLocation, toast]);

  // ── Cycle map type ─────────────────────────────────────────────────────────
  const cycleMapType = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMapTypeIndex((prev) => (prev + 1) % MAP_TYPES.length);
  }, []);

  // ── F11: debounce-save the map viewport to AsyncStorage ──────────────────────
  // Persists once the map settles (REGION_DEBOUNCE_MS after the last frame) so
  // the next launch resumes here instead of snapping back to the user's GPS.
  const scheduleSaveRegion = useCallback((region: Region) => {
    if (regionSaveDebounceRef.current) clearTimeout(regionSaveDebounceRef.current);
    regionSaveDebounceRef.current = setTimeout(() => {
      saveMapRegion(region);
    }, REGION_DEBOUNCE_MS);
  }, []);

  // ── "Search this area" → re-query bbox (§3.7, §4.1) ────────────────────────
  const handleSearchArea = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const bbox = regionToBbox(mapRegion);
    setQueryBbox(bbox);
    setSearchMode('area');
    lastQueriedCenterRef.current = { lat: mapRegion.latitude, lng: mapRegion.longitude };
    lastQueriedZoomRef.current = mapRegion.latitudeDelta;
    setShowSearchPill(false);
  }, [mapRegion]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const handleFilterPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilterVisible(true);
  }, []);

  // Category chips and the filter sheet share activeFilters.category, so the
  // badge counts a chip-picked category too.
  const filterCount = [activeFilters.category, activeFilters.condition, activeFilters.language].filter(Boolean).length;

  // ── Save current search to AsyncStorage (saved-searches feature) ───────────
  const handleSaveSearch = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const raw = await AsyncStorage.getItem(SAVED_SEARCHES_KEY);
      const list = raw ? (JSON.parse(raw) as any[]) : [];
      // Save what was actually searched: the circle around the user in
      // radius mode, the searched viewport in area mode — plus every filter.
      const center =
        useRadiusMode && userLocation
          ? userLocation
          : queryBbox
            ? { lat: (queryBbox.min_lat + queryBbox.max_lat) / 2, lng: (queryBbox.min_lng + queryBbox.max_lng) / 2 }
            : { lat: mapRegion.latitude, lng: mapRegion.longitude };
      const radiusKm =
        useRadiusMode || !queryBbox
          ? geofenceRadiusKm
          : Math.max(1, Math.round(((queryBbox.max_lat - queryBbox.min_lat) * 111) / 2));
      const newSearch = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: activeFilters.category ?? null,
        condition: activeFilters.condition ?? null,
        language: activeFilters.language ?? null,
        q: debouncedSearch || null,
        radius_km: radiusKm,
        lat: center.lat,
        lng: center.lng,
        created_at: new Date().toISOString(),
      };
      await AsyncStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify([newSearch, ...list]));
      toast.show('Arama kaydedildi', { variant: 'success' });
    } catch {
      toast.show('Kaydetme başarısız', { variant: 'error' });
    }
  }, [activeFilters, mapRegion, geofenceRadiusKm, toast, useRadiusMode, userLocation, queryBbox, debouncedSearch]);

  // ── Chip select (with haptic) ──────────────────────────────────────────────
  const handleChipPress = useCallback((cat: BookCategory | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveFilters((prev) => ({ ...prev, category: prev.category === cat ? null : cat }));
  }, []);

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
    (book: MapBook, coordinateOverride?: { latitude: number; longitude: number }) => {
      const coordinate = coordinateOverride ?? (book.public_location
        ? { latitude: book.public_location.lat, longitude: book.public_location.lng }
        : null);
      if (!coordinate) return null;
      const variant = getSingletonVariant(book);
      return (
        <BookMarker
          key={book.id}
          coordinate={coordinate}
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

  // ── Render a shelf cluster "spiderfied" into its individual book pins ──────
  // Used once the map is zoomed in past SPIDERFY_ZOOM, so co-located books
  // become tappable side-by-side pins instead of one collapsed +N marker.
  const renderSpiderfiedCluster = useCallback(
    (cluster: ClusterPoint) => {
      const members = cluster.books?.length
        ? cluster.books
        : books.filter((b) => cluster.book_ids.includes(b.id));
      if (members.length === 0) return null;
      return members.map((book, index) =>
        renderSingleton(book, spiderfyOffset(cluster.centroid, index, members.length)),
      );
    },
    [books, renderSingleton],
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
      // F12: recency indicator — "Yeni" (<24h, green) / "Bu hafta" (1-7d, blue).
      const recency = getRecency(item);
      return (
        <TouchableOpacity
          style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => handleMarkerPress(item)}
          testID={`mini-card-${item.id}`}
        >
          <View style={[styles.miniCardCover, { backgroundColor: colors.surfaceAlt }]}>
            {coverUrl ? (
              <BookCover url={coverUrl} size={48} />
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
              {recency && (
                <View
                  style={[styles.miniCardRecency, { backgroundColor: colors[recency.colorKey] + '20' }]}
                  testID={`mini-card-recency-${item.id}`}
                >
                  <View style={[styles.miniCardRecencyDot, { backgroundColor: colors[recency.colorKey] }]} />
                  <Text style={[styles.miniCardRecencyText, { color: colors[recency.colorKey] }]}>
                    {recency.label}
                  </Text>
                </View>
              )}
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
        onBookDetail={() => router.push(`/book/${item.id}`)}
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
  // Capped when the SERVER returned a full page — measured before the local
  // shadow-block filter, which can drop a few below the limit.
  const countCapped = rawBooks.length >= BBOX_LIMIT;
  const sheetHeader = useMemo(
    () => (
      <View style={styles.sheetHeader}>
        {booksWithLocation.length > 0 ? (
          <Text style={[styles.sheetResultCount, { color: colors.text }]}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>
              {booksWithLocation.length}{countCapped ? '+' : ''}
            </Text>
            {' '}kitap bulundu
          </Text>
        ) : (
          <View />
        )}
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
          mapStyle={mapStyle}
          onRegionDidChange={(event: any) => {
            // maplibre-react-native v11 delivers a NativeSyntheticEvent whose
            // payload is { center: [lng, lat], zoom, ... } on event.nativeEvent —
            // not the pre-v11 GeoJSON feature ({ geometry, properties.zoomLevel }).
            // Support both so mapRegion actually tracks pan/zoom.
            const ne = event?.nativeEvent ?? event;
            const center = ne?.center ?? event?.geometry?.coordinates;
            if (center) {
              const [lng, lat] = center;
              const zoom = ne?.zoom ?? event?.properties?.zoomLevel ?? 12;
              const delta = 360 / Math.pow(2, zoom);
              const region: Region = {
                latitude: lat,
                longitude: lng,
                latitudeDelta: delta,
                longitudeDelta: delta,
              };
              setMapRegion(region);
              // F11: persist the settled viewport (debounced) for next launch.
              scheduleSaveRegion(region);
              // "Bu alanı ara": offer a re-query once the view drifted
              // meaningfully (pan or zoom) from what was last searched.
              const lastC = lastQueriedCenterRef.current;
              const lastZ = lastQueriedZoomRef.current;
              if (lastC && lastZ) {
                const panned =
                  Math.abs(lat - lastC.lat) > lastZ * PILL_PAN_FRACTION ||
                  Math.abs(lng - lastC.lng) > lastZ * PILL_PAN_FRACTION;
                const zoomed = delta / lastZ > PILL_ZOOM_FACTOR || lastZ / delta > PILL_ZOOM_FACTOR;
                if (panned || zoomed) setShowSearchPill(true);
              }
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
          {/* ── Book density heatmap (toggle, blue→green→yellow→red) ─────────── */}
          {showHeatmap && (
            <MLGeoJSONSource id="book-density-source" data={heatmapGeoJSON}>
              <HeatmapLayer
                id="book-density-heatmap"
                type="heatmap"
                sourceID="book-density-source"
                paint={{
                  // Smooth radius that grows with zoom for a consistent on-screen blob
                  'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 40],
                  // Cluster points weigh by book count; singletons weigh 1
                  'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 10, 1],
                  // Intensity ramps with zoom so low-zoom areas stay readable
                  'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
                  // Density gradient: blue (sparse) → green → yellow → red (dense)
                  'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(0,0,255,0)',
                    0.2, 'rgba(0,0,255,0.55)',
                    0.4, 'rgba(0,200,40,0.65)',
                    0.6, 'rgba(255,215,0,0.8)',
                    0.8, 'rgba(255,45,0,0.9)',
                    1, 'rgba(150,0,0,1)',
                  ],
                  'heatmap-opacity': 0.9,
                }}
              />
            </MLGeoJSONSource>
          )}
          {/* ── Individual book markers (singletons) ─────────────────────────── */}
          {safeMap(markerBooks, (book) => {
            if (!book.public_location) return null;
            return renderSingleton(book);
          }, 'markerBooks')}

          {/* Shelf markers from backend clusters (30m grouping, §3.4 shelf variant).
              Past SPIDERFY_ZOOM, expand each shelf into its individual book pins
              spaced around the shared point instead of one collapsed +N marker. */}
          {safeMap(clusters, (cluster) =>
            deltaToZoom(mapRegion.latitudeDelta) >= SPIDERFY_ZOOM
              ? renderSpiderfiedCluster(cluster)
              : renderShelf(cluster)
          , 'clusters')}

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

      {/* ── Error overlay when book query fails (network/server error) ── */}
      {activeListQuery.isError && (
        <View style={styles.errorOverlay} pointerEvents="auto" testID="bbox-error">
          <Ionicons name="cloud-offline-outline" size={48} color="#FFFFFF" style={{ marginBottom: 12 }} />
          <Text style={styles.errorTitle}>Kitaplar yüklenemedi</Text>
          <Text style={styles.errorMessage}>İnternet bağlantınızı kontrol edin.</Text>
          <TouchableOpacity
            style={styles.errorRetryBtn}
            onPress={() => activeListQuery.refetch()}
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
          {/* Search row: search bar + notification bell + bookmark */}
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
              </View>
            </View>

            {/* Bell icon → /notifications, with unread dot */}
            <TouchableOpacity
              onPress={() => router.push('/notifications')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="notifications-bell"
            >
              <View style={[styles.filterBtn, { backgroundColor: isDark ? 'rgba(33,31,26,0.90)' : 'rgba(255,255,255,0.92)' }]}>
                <Ionicons name="notifications" size={20} color={colors.primary} />
                {unreadCount > 0 && <View style={styles.bellDot} testID="notifications-unread-dot" />}
              </View>
            </TouchableOpacity>

            {/* Save current search → AsyncStorage (saved-searches feature) */}
            <TouchableOpacity
              onPress={handleSaveSearch}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="save-search"
            >
              <View style={[styles.filterBtn, { backgroundColor: isDark ? 'rgba(33,31,26,0.90)' : 'rgba(255,255,255,0.92)' }]}>
                <Ionicons name="bookmark-outline" size={20} color={colors.primary} />
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
            {/* Course-code search: "who has the MAT101 book?" */}
            <TouchableOpacity
              style={[
                styles.chip,
                { backgroundColor: isDark ? 'rgba(33,31,26,0.88)' : 'rgba(255,255,255,0.92)' },
              ]}
              onPress={() => router.push('/course-search' as any)}
              testID="chip-course-search"
              accessibilityRole="button"
              accessibilityLabel="Ders koduna göre ara"
            >
              <Ionicons name="school" size={14} color={colors.primary} />
              <Text style={[styles.chipText, { color: colors.text }]}>Ders Kodu</Text>
            </TouchableOpacity>
            {CATEGORIES.map((cat) => {
              const isActive = (activeFilters.category ?? null) === cat.value;
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

          {/* Push permission banner (first launch, dismissible) */}
          {showPushBanner && (
            <View style={[styles.pushBanner, { backgroundColor: colors.primarySoft }]} testID="push-banner">
              <Ionicons name="notifications" size={20} color={colors.primary} />
              <Text style={[styles.pushBannerText, { color: colors.text }]}>
                Bildirimleri açın, yeni talepleri anında öğrenin
              </Text>
              <TouchableOpacity onPress={requestPushPermission} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="push-allow">
                <Text style={[styles.pushAllow, { color: colors.primary }]}>İzin Ver</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={dismissPushBanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="push-dismiss">
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
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
        emptyComponent={
          activeListQuery.isError ? (
            <EmptyState
              message="Kitaplar yüklenemedi"
              description="İnternet bağlantınızı kontrol edin."
              icon="cloud-offline-outline"
            />
          ) : showSkeletons ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              {[...Array(5)].map((_, i) => (
                <View
                  key={i}
                  style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.miniCardCover, { backgroundColor: colors.surfaceAlt }]}>
                    <View style={[styles.skeletonBox, { width: 48, height: 64, backgroundColor: colors.surfaceAlt }]} />
                  </View>
                  <View style={styles.miniCardInfo}>
                    <View style={[styles.skeletonLine, { width: '70%', height: 14, backgroundColor: colors.surfaceAlt, marginBottom: 6 }]} />
                    <View style={[styles.skeletonLine, { width: '40%', height: 12, backgroundColor: colors.surfaceAlt, marginBottom: 6 }]} />
                    <View style={styles.miniCardMeta}>
                      <View style={[styles.skeletonPill, { width: 50, height: 20, backgroundColor: colors.surfaceAlt }]} />
                      <View style={[styles.skeletonLine, { width: 30, height: 12, backgroundColor: colors.surfaceAlt, marginLeft: 8 }]} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              message="Bu bölgede kitap yok"
              description="Arama alanını genişlet veya filtreleri değiştir"
              icon="library-outline"
            />
          )
        }
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
        radiusKm={geofenceRadiusKm}
        onRadiusChange={handleRadiusChange}
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
  // Floating action button (vision: 44×44, blur, used by bell + bookmark)
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
  // Bell unread dot (top-right of the bell button)
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F2766B',
    borderWidth: 2,
    borderColor: '#FFFFFF',
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

  // Push permission banner (first launch, dismissible)
  pushBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    gap: spacing.sm,
    ...shadows.card,
  },
  pushBannerText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  pushAllow: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
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
  // F12: recency indicator badge on mini cards ("Yeni" / "Bu hafta")
  miniCardRecency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  miniCardRecencyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  miniCardRecencyText: {
    fontSize: 11,
    fontWeight: '700',
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

  skeletonBox: {
    borderRadius: 4,
  },
  skeletonLine: {
    borderRadius: 3,
  },
  skeletonPill: {
    borderRadius: 10,
  },
});
