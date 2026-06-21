import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';

import { BookCard, EmptyState, Skeleton, palette, spacing, fontSize, radius, shadows, FilterSheet, type FilterState } from '@/components/ui';
import { BookMarker } from '@/components/ui/book-marker';

import { searchNearbyBooks } from '@/lib/api/client';

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

export default function HomeScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [searchText, setSearchText] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'distance' | 'newest'>('distance');
  const [filterVisible, setFilterVisible] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
    radiusKm: 10,
  });
  const [mapRegion, setMapRegion] = useState({
    latitude: 41.0082,
    longitude: 28.9784,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        setMapRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (viewMode === 'map' && userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  }, [viewMode, userLocation]);

  const toggleViewMode = (mode: 'list' | 'map') => {
    setViewMode(mode);
  };

  const toggleFavorite = (bookId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['books', 'nearby', userLocation?.lat, userLocation?.lng, selectedCategory, searchText, activeFilters],
    queryFn: () =>
      searchNearbyBooks({
        lat: userLocation!.lat,
        lng: userLocation!.lng,
        category: selectedCategory ?? activeFilters.category ?? undefined,
        condition: activeFilters.condition ?? undefined,
        language: activeFilters.language ?? undefined,
        radius_km: activeFilters.radiusKm,
        q: searchText || undefined,
      }),
    enabled: !!userLocation,
  });
  const books = data?.items ?? [];

  const sortedBooks = [...books].sort((a, b) => {
    if (sortBy === 'distance') return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
    return 0;
  });

  const recenterOnUser = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

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
        <TouchableOpacity
          onPress={() => toggleViewMode(viewMode === 'list' ? 'map' : 'list')}
          style={[styles.mapToggleBtn, { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' }]}
          testID="view-toggle"
        >
          <Ionicons
            name={viewMode === 'list' ? 'map-outline' : 'list-outline'}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilterVisible(true)}
          style={[styles.mapToggleBtn, { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' }]}
          testID="filter-btn"
        >
          <Ionicons name="options-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
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

      {selectedCategory && (
        <View style={styles.activeFilterRow}>
          <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.activeChipText, { color: colors.primary }]}>
              {CATEGORIES.find((c) => c.value === selectedCategory)?.label}
            </Text>
            <TouchableOpacity onPress={() => setSelectedCategory(null)}>
              <Ionicons name="close-circle" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {(activeFilters.condition || activeFilters.language) && (
        <View style={styles.activeFilterRow}>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
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

      {viewMode === 'list' && (
        <View style={styles.sortRow}>
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
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>

      {viewMode === 'list' ? (
        <>
          {renderSearchAndChips()}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoading || !userLocation ? (
              <>
                <Skeleton variant="card" />
                <Skeleton variant="card" />
                <Skeleton variant="card" />
              </>
            ) : sortedBooks.length === 0 ? (
              <EmptyState
                message="Kitap bulunamadı"
                description="Yakınlarda takas için kitap yok"
              />
            ) : (
              sortedBooks.map((book) => (
                <BookCard
                  key={book.id}
                  title={book.title}
                  author={book.author ?? ''}
                  condition={book.condition as any}
                  category={(book.category as string) ?? ''}
                  distanceKm={book.distance_km}
                  coverUrl={book.photos?.[0]?.url}
                  onPress={() => router.push(`/book/${book.id}`)}
                  onFavorite={() => toggleFavorite(book.id)}
                  testID={`book-card-${book.id}`}
                />
              ))
            )}
          </ScrollView>
        </>
      ) : (
        <View style={styles.mapContainer}>
          
          <ClusteredMapView
            ref={mapRef as any}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            initialRegion={mapRegion}
            showsUserLocation
            showsMyLocationButton={false}
            onRegionChangeComplete={setMapRegion}
            clusteringEnabled={false}
            >
            {books.map((book) => {
              if (!book.public_location) return null;
              return (
                <BookMarker
                  key={book.id}
                  coordinate={{
                    latitude: book.public_location.lat,
                    longitude: book.public_location.lng,
                  }}
                  coverUrl={book.photos?.[0]?.url}
                  thumbnailUrl={book.photos?.[0]?.thumbnail_url}
                  title={book.title}
                  onPress={() => router.push(`/book/${book.id}`)}
                />
              );
            })}
          </ClusteredMapView>

          <View style={[styles.floatingSearchContainer, { paddingTop: insets.top }]}>
            {renderSearchAndChips()}
          </View>

          <TouchableOpacity
            style={[styles.recenterBtn, { backgroundColor: colors.surface, shadowColor: colors.text }]}
            onPress={recenterOnUser}
            activeOpacity={0.7}
            testID="recenter-btn"
          >
            <Ionicons name="locate-outline" size={22} color={colors.primary} />
          </TouchableOpacity>

          <View style={[styles.mapBottomBar, { backgroundColor: colors.surface }]}>
            <Text style={[styles.resultCountText, { color: colors.text }]}>
              {books.length} kitap bulundu
            </Text>
            <View style={styles.mapBottomActions}>
              <TouchableOpacity
                style={[styles.mapActionBtn, { backgroundColor: colors.primary + '20' }]}
                onPress={recenterOnUser}
              >
                <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                <Text style={[styles.mapActionText, { color: colors.primary }]}>Yakınım</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapActionBtn, { backgroundColor: colors.primary + '20' }]}
                onPress={() => refetch()}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.primary} />
                <Text style={[styles.mapActionText, { color: colors.primary }]}>Yenile</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

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
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
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
  mapToggleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipRow: {
    maxHeight: 44,
    marginBottom: spacing.sm,
  },
  chipContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
     width: 'auto',
    justifyContent: 'center',
   
  },
  chipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  activeFilterRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  activeChipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sortPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sortPillText: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  scrollContent: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  floatingSearchContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  recenterBtn: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xxl + 56,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },
  mapBottomBar: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sheet,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.card,
  },
  resultCountText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  mapBottomActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mapActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  mapActionText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
