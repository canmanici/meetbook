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
  PixelRatio,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';

import {
  BookCard,
  EmptyState,
  FilterSheet,
  type FilterState,
  Skeleton,
  palette,
  spacing,
  fontSize,
  radius,
  shadows,
} from '@/components/ui';
import { MapBookPin } from '@/components/ui/map-book-pin';

import { searchNearbyBooks } from '@/lib/api/client';

export default function SearchScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
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
      }
    })();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: [
      'books',
      'search',
      userLocation?.lat,
      userLocation?.lng,
      searchQuery,
      activeFilters.category,
      activeFilters.condition,
      activeFilters.language,
      activeFilters.radiusKm,
    ],
    queryFn: () =>
      searchNearbyBooks({
        lat: userLocation!.lat,
        lng: userLocation!.lng,
        q: searchQuery || undefined,
        category: activeFilters.category || undefined,
        condition: activeFilters.condition || undefined,
      }),
    enabled: !!userLocation,
  });
  const books = data?.items ?? [];

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

  const hasActiveFilters =
    activeFilters.category !== null ||
    activeFilters.condition !== null ||
    activeFilters.language !== null;

  const removeFilter = (key: keyof FilterState) => {
    setActiveFilters((prev) => ({ ...prev, [key]: key === 'radiusKm' ? 10 : null }));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ara</Text>
        <TouchableOpacity
          style={[styles.viewToggle, { backgroundColor: colors.surface }]}
          onPress={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
          activeOpacity={0.7}
          testID="view-toggle"
        >
          <Ionicons
            name={viewMode === 'list' ? 'map-outline' : 'list-outline'}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.textMuted + '40' }]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Kitap veya yazar ara..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          testID="search-input"
        />
        <TouchableOpacity
          style={styles.cameraBtn}
          onPress={() => router.push('/book/scan-isbn')}
          activeOpacity={0.7}
          testID="scan-btn"
        >
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: colors.textMuted + '40' }]} />
        <TouchableOpacity
          style={styles.filterBtn}
          onPress={() => setFilterVisible(true)}
          activeOpacity={0.7}
          testID="filter-btn"
        >
          <Ionicons name="options-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {hasActiveFilters && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.activeFilterRow}
          contentContainerStyle={styles.activeFilterContent}
        >
          {activeFilters.category && (
            <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.activeChipText, { color: colors.primary }]}>{activeFilters.category}</Text>
              <TouchableOpacity onPress={() => removeFilter('category')} testID="dismiss-category">
                <Ionicons name="close-circle" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
          {activeFilters.condition && (
            <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.activeChipText, { color: colors.primary }]}>{activeFilters.condition}</Text>
              <TouchableOpacity onPress={() => removeFilter('condition')} testID="dismiss-condition">
                <Ionicons name="close-circle" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
          {activeFilters.language && (
            <View style={[styles.activeChip, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.activeChipText, { color: colors.primary }]}>{activeFilters.language}</Text>
              <TouchableOpacity onPress={() => removeFilter('language')} testID="dismiss-language">
                <Ionicons name="close-circle" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {viewMode === 'list' ? (
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
          ) : books.length === 0 ? (
            <EmptyState
              message="Sonuç bulunamadı"
              description="Bu kriterlere uygun kitap yok"
            />
          ) : (
            books.map((book) => (
              <BookCard
                key={book.id}
                title={book.title}
                author={book.author ?? ''}
                condition={book.condition as any}
                category={(book.category as string) ?? ''}
                distanceKm={book.distance_km}
                coverUrl={book.photos?.[0]?.url}
                onPress={() => router.push(`/book/${book.id}`)}
                testID={`book-card-${book.id}`}
              />
            ))
          )}
        </ScrollView>
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
          >
            {books.map((book) => {
              if (!book.public_location) return null;
              return (
                <Marker
                  key={book.id}
                  coordinate={{
                    latitude: book.public_location.lat,
                    longitude: book.public_location.lng,
                  }}
                  onPress={() => router.push(`/book/${book.id}`)}
                  style={{ width: 120 * PixelRatio.get(), height: 178 * PixelRatio.get(), alignItems: 'flex-start' }}
                >
                  <MapBookPin
                    coverUrl={book.photos?.[0]?.url}
                    thumbnailUrl={book.photos?.[0]?.thumbnail_url}
                    title={book.title}
                  />
                </Marker>
              );
            })}
          </ClusteredMapView>

          <TouchableOpacity
            style={[styles.recenterBtn, { backgroundColor: colors.surface, shadowColor: colors.text }]}
            onPress={recenterOnUser}
            activeOpacity={0.7}
            testID="recenter-btn"
          >
            <Ionicons name="locate-outline" size={22} color={colors.primary} />
          </TouchableOpacity>

          <View style={[styles.resultCount, { backgroundColor: colors.surface }]}>
            <Text style={[styles.resultCountText, { color: colors.text }]}>
              {books.length} kitap bulundu
            </Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  viewToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: fontSize.bodySm,
  },
  cameraBtn: {
    padding: spacing.xs,
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: spacing.sm,
  },
  filterBtn: {
    padding: spacing.xs,
  },
  activeFilterRow: {
    maxHeight: 40,
    marginBottom: spacing.sm,
  },
  activeFilterContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  activeChipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
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
  resultCount: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    ...shadows.card,
  },
  resultCountText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});
