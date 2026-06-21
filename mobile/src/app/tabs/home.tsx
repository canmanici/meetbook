import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  useColorScheme,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import MapView, { PROVIDER_GOOGLE, Marker, type Region } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui/tokens';
import { BookCard, FilterSheet, type FilterState } from '@/components/ui';
import { searchNearbyBooks } from '@/lib/api/client';
import { useFavoritesStore } from '@/stores/favorites';
import BookBottomSheet from '@/components/map/book-bottom-sheet';
import MarkerPreviewCard from '@/components/map/marker-preview-card';
import type { PreviewBook } from '@/components/map/marker-preview-card';
import { RightControls } from '@/components/map/right-controls';
import { SearchAreaPill } from '@/components/map/search-area-pill';
import { RadiusCircle } from '@/components/map/radius-circle';
import { UserLocationDot } from '@/components/map/user-location-dot';

const CATEGORIES = [
  { value: null, label: 'Tümü' },
  { value: 'fiction', label: 'Roman' },
  { value: 'non_fiction', label: 'Popüler Bilim' },
  { value: 'textbook', label: 'Ders Kitabı' },
  { value: 'comics', label: 'Çizgi Roman' },
  { value: 'children', label: 'Çocuk' },
  { value: 'poetry', label: 'Şiir' },
  { value: 'other', label: 'Diğer' },
];

type MarkerVariant = 'fresh' | 'premium' | 'standard' | 'shelf' | 'unavailable' | 'recent';

const VARIANT_CONFIG: Record<MarkerVariant, { color: string }> = {
  fresh: { color: '#2FA36B' },
  premium: { color: '#E8A13A' },
  standard: { color: '#11806B' },
  shelf: { color: '#F2766B' },
  unavailable: { color: '#8A8378' },
  recent: { color: '#5B9BD5' },
};

const MAP_TYPES: Array<'standard' | 'satellite' | 'hybrid'> = ['standard', 'satellite', 'hybrid'];

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F5F0E8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8A8378' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F5F0E8' }] },
  { featureType: 'road', stylers: [{ color: '#ECE4D6' }] },
  { featureType: 'water', stylers: [{ color: '#D6EFE7' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function getMarkerVariant(book: { condition: string; is_available: boolean; created_at: string; category: string }): MarkerVariant {
  if (!book.is_available) return 'unavailable';
  if (book.condition === 'new') return 'fresh';
  if (book.condition === 'like_new') return 'premium';
  if (book.created_at) {
    const created = new Date(book.created_at).getTime();
    if (Date.now() - created < 7 * 24 * 60 * 60 * 1000) return 'recent';
  }
  if (book.category === 'fiction') return 'shelf';
  return 'standard';
}

export default function HomeScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [queryCenter, setQueryCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedBook, setSelectedBook] = useState<PreviewBook | null>(null);
  const [showSearchPill, setShowSearchPill] = useState(false);
  const [mapTypeIndex, setMapTypeIndex] = useState(0);
  const [sheetSnapIndex, setSheetSnapIndex] = useState(1);
  const [sortBy, setSortBy] = useState<'distance' | 'newest'>('distance');
  const [filterVisible, setFilterVisible] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
    radiusKm: 10,
  });
  const filterCount = [activeFilters.category, activeFilters.condition, activeFilters.language].filter(Boolean).length;
  const [mapRegion, setMapRegion] = useState({
    latitude: 41.0082,
    longitude: 28.9784,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });

  const mapRef = useRef<MapView>(null);
  const lastQueriedCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const favoritesStore = useFavoritesStore();

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const userLoc = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setUserLocation(userLoc);
        setQueryCenter(userLoc);
        lastQueriedCenterRef.current = userLoc;
        setMapRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      }
    })();
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['books', 'nearby', queryCenter?.lat, queryCenter?.lng, selectedCategory, searchText, activeFilters.condition, activeFilters.language, activeFilters.radiusKm],
    queryFn: () => {
      if (!queryCenter) throw new Error('No query center');
      return searchNearbyBooks({
        lat: queryCenter.lat,
        lng: queryCenter.lng,
        category: selectedCategory ?? activeFilters.category ?? undefined,
        condition: activeFilters.condition ?? undefined,
        language: activeFilters.language ?? undefined,
        radius_km: activeFilters.radiusKm,
        q: searchText || undefined,
      });
    },
    enabled: !!queryCenter,
  });
  const books = data?.items ?? [];

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      if (sortBy === 'distance') return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [books, sortBy]);

  const handleMarkerPress = useCallback((book: { id: string; title: string; author?: string; owner_name: string; distance_km: number; photos?: Array<{ url?: string; thumbnail_url?: string }> }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedBook({
      id: book.id,
      title: book.title,
      author: book.author ?? null,
      coverUrl: book.photos?.[0]?.thumbnail_url ?? book.photos?.[0]?.url ?? null,
      distanceKm: book.distance_km,
      ownerName: book.owner_name,
      isFavorited: favoritesStore.isFavorited(book.id),
    });
  }, [favoritesStore]);

  const handleFavoriteToggle = useCallback((bookId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (favoritesStore.isFavorited(bookId)) {
      favoritesStore.removeFavorite(bookId);
    } else {
      const book = books.find(b => b.id === bookId);
      if (book) {
        favoritesStore.addFavorite({
          bookId: book.id,
          title: book.title,
          coverUrl: book.photos?.[0]?.url,
          ownerId: book.owner_id,
          addedAt: new Date().toISOString(),
        });
      }
    }
    setSelectedBook(prev => prev?.id === bookId ? { ...prev, isFavorited: !prev.isFavorited } : prev);
  }, [books, favoritesStore]);

  const handleRequestExchange = useCallback((bookId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/book/${bookId}?action=exchange`);
  }, []);

  const handleNavigateToDetail = useCallback((bookId: string) => {
    router.push(`/book/${bookId}`);
  }, []);

  const recenterOnUser = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  }, [userLocation]);

  const fitAllMarkers = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const coords = books.filter(b => b.public_location).map(b => ({
      latitude: b.public_location.lat,
      longitude: b.public_location.lng,
    }));
    if (coords.length === 0 || !mapRef.current) return;
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) {
      if (c.latitude < minLat) minLat = c.latitude;
      if (c.latitude > maxLat) maxLat = c.latitude;
      if (c.longitude < minLng) minLng = c.longitude;
      if (c.longitude > maxLng) maxLng = c.longitude;
    }
    const latDelta = (maxLat - minLat) * 1.5 || 0.02;
    const lngDelta = (maxLng - minLng) * 1.5 || 0.02;
    mapRef.current.animateToRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(latDelta, 0.01),
      longitudeDelta: Math.max(lngDelta, 0.01),
    });
  }, [books]);

  const cycleMapType = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMapTypeIndex(prev => (prev + 1) % MAP_TYPES.length);
  }, []);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    setMapRegion(region);
    if (lastQueriedCenterRef.current) {
      const dLat = Math.abs(region.latitude - lastQueriedCenterRef.current.lat);
      const dLng = Math.abs(region.longitude - lastQueriedCenterRef.current.lng);
      if (dLat > 0.01 || dLng > 0.01) {
        setShowSearchPill(true);
      }
    }
  }, []);

  const handleSearchArea = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQueryCenter({ lat: mapRegion.latitude, lng: mapRegion.longitude });
    lastQueriedCenterRef.current = { lat: mapRegion.latitude, lng: mapRegion.longitude };
    setShowSearchPill(false);
  }, [mapRegion]);

  const handleFilterPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilterVisible(true);
  }, []);

  const renderSearchAndChips = () => (
    <>
      <View style={styles.searchRow}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' }]}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Kitap veya yazar ara..."
            placeholderTextColor={colors.textMuted}
            value={searchText}
            onChangeText={setSearchText}
            testID="search-input"
          />
          <TouchableOpacity onPress={() => router.push('/book/scan-isbn')} style={styles.searchIconBtn}>
            <Ionicons name="camera-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipContent}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.label}
            style={[
              styles.chip,
              { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' },
              selectedCategory === cat.value && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
            testID={`chip-${cat.label}`}
          >
            <Text
              style={[
                styles.chipText,
                { color: colors.text },
                selectedCategory === cat.value && { color: '#fff' },
              ]}
            >
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {(selectedCategory || activeFilters.condition || activeFilters.language) && (
        <View style={styles.activeFilterRow}>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            {selectedCategory && (
              <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.activeChipText, { color: colors.primary }]}>
                  {CATEGORIES.find((c) => c.value === selectedCategory)?.label}
                </Text>
                <TouchableOpacity onPress={() => setSelectedCategory(null)}>
                  <Ionicons name="close-circle" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
            {activeFilters.condition && (
              <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.activeChipText, { color: colors.primary }]}>{activeFilters.condition}</Text>
                <TouchableOpacity onPress={() => setActiveFilters((p) => ({ ...p, condition: null }))}>
                  <Ionicons name="close-circle" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
            {activeFilters.language && (
              <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.activeChipText, { color: colors.primary }]}>{activeFilters.language}</Text>
                <TouchableOpacity onPress={() => setActiveFilters((p) => ({ ...p, language: null }))}>
                  <Ionicons name="close-circle" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.searchExtra}>
        <TouchableOpacity
          style={[
            styles.sortPill,
            { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' },
            sortBy === 'distance' && { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          onPress={() => setSortBy('distance')}
        >
          <Text style={[styles.sortPillText, { color: colors.text }, sortBy === 'distance' && { color: '#fff' }]}>
            Yakınlık
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sortPill,
            { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' },
            sortBy === 'newest' && { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          onPress={() => setSortBy('newest')}
        >
          <Text style={[styles.sortPillText, { color: colors.text }, sortBy === 'newest' && { color: '#fff' }]}>
            En Yeni
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderMarker = (book: { id: string; title: string; author?: string; condition: string; is_available: boolean; created_at: string; category: string; owner_name: string; distance_km: number; public_location: { lat: number; lng: number } | null; photos?: Array<{ url?: string; thumbnail_url?: string }> }) => {
    if (!book.public_location) return null;
    const variant = getMarkerVariant(book);
    const config = VARIANT_CONFIG[variant];
    const coverUri = book.photos?.[0]?.thumbnail_url || book.photos?.[0]?.url;

    return (
      <Marker
        key={book.id}
        coordinate={{ latitude: book.public_location.lat, longitude: book.public_location.lng }}
        tracksViewChanges={false}
        onPress={() => handleMarkerPress(book)}
      >
        <View style={[styles.markerOuter, { borderColor: config.color }]}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.markerCover} resizeMode="cover" />
          ) : (
            <View style={[styles.markerCover, styles.markerPlaceholder]}>
              <Text style={styles.markerPlaceholderText}>{book.title.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={[styles.variantDot, { backgroundColor: config.color }]} />
        </View>
      </Marker>
    );
  };

  const bottomSheetHeader = useMemo(() => (
    <View style={styles.sheetHeader}>
      <Text style={[styles.sheetResultCount, { color: colors.text }]}>
        {books.length} kitap bulundu
      </Text>
      <View style={styles.sheetHeaderActions}>
        <TouchableOpacity
          style={[styles.sortPill, { backgroundColor: colors.surfaceAlt, borderColor: 'transparent' }]}
          onPress={() => setSortBy(prev => prev === 'distance' ? 'newest' : 'distance')}
        >
          <Ionicons name="swap-vertical-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sortPillText, { color: colors.textMuted, marginLeft: 4 }]}>
            {sortBy === 'distance' ? 'Yakınlık' : 'En Yeni'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [books.length, colors, sortBy]);

  const renderBookCard = useCallback(({ item }: { item: any }) => (
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
  ), [favoritesStore]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ClusteredMapView
        ref={mapRef as any}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        region={mapRegion}
        mapType={MAP_TYPES[mapTypeIndex]}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onRegionChangeComplete={handleRegionChangeComplete}
        customMapStyle={MAP_STYLE}
      >
        {userLocation && (
          <RadiusCircle center={userLocation} radiusKm={activeFilters.radiusKm} color={colors.primary} />
        )}
        {userLocation && (
          <UserLocationDot coordinate={userLocation} color={colors.primary} />
        )}
        {books.map(renderMarker)}
      </ClusteredMapView>

      <View style={[styles.floatingSearch, { paddingTop: insets.top + spacing.sm }]}>
        {renderSearchAndChips()}
      </View>

      {showSearchPill && (
        <SearchAreaPill onPress={handleSearchArea} />
      )}

      <RightControls
        onRecenter={recenterOnUser}
        onFilter={handleFilterPress}
        onFitAll={fitAllMarkers}
        onCycleMapType={cycleMapType}
        filterCount={filterCount}
        isDark={isDark}
        insets={insets}
        colors={colors}
      />

      {selectedBook && (
        <MarkerPreviewCard
          book={selectedBook}
          onFavoriteToggle={handleFavoriteToggle}
          onRequestExchange={handleRequestExchange}
          onNavigateToDetail={handleNavigateToDetail}
        />
      )}

      <BookBottomSheet
        snapIndex={sheetSnapIndex}
        onSnapChange={setSheetSnapIndex}
        data={sortedBooks as any}
        renderItem={renderBookCard as any}
        header={bottomSheetHeader}
        keyExtractor={(item: any) => item.id}
      />

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        onApply={(filters) => {
          setActiveFilters(filters);
          setFilterVisible(false);
        }}
        resultCount={books.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  floatingSearch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingBottom: spacing.xs,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: fontSize.bodySm,
  },
  searchIconBtn: {
    marginLeft: spacing.xs,
    padding: spacing.xs,
  },
  chipRow: { maxHeight: 44, marginBottom: spacing.xs },
  chipContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  chipText: { fontSize: fontSize.bodySm, fontWeight: '500' },
  activeFilterRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  activeChipText: { fontSize: fontSize.bodySm, fontWeight: '600' },
  searchExtra: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sortPillText: { fontSize: fontSize.caption, fontWeight: '500' },
  markerOuter: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 2.5,
    backgroundColor: '#fff',
    padding: 2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
      android: { elevation: 5 },
    }),
  },
  markerCover: {
    width: '100%',
    height: '100%',
    borderRadius: 9,
    backgroundColor: '#000',
  },
  markerPlaceholder: {
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerPlaceholderText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  variantDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  sheetResultCount: { fontSize: fontSize.body, fontWeight: '700' },
  sheetHeaderActions: { flexDirection: 'row', gap: spacing.sm },
});
