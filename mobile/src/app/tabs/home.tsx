import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { BookCard, EmptyState, Skeleton, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { searchNearbyBooks } from '@/lib/api/client';

const CATEGORIES = [
  { value: null, label: 'Tümü' },
  { value: 'fiction', label: 'Roman' },
  { value: 'textbook', label: 'Ders Kitabı' },
  { value: 'comics', label: 'Çizgi Roman' },
  { value: 'children', label: 'Çocuk' },
  { value: 'poetry', label: 'Şiir' },
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
    queryKey: ['books', 'nearby', userLocation?.lat, userLocation?.lng, selectedCategory, searchText],
    queryFn: () =>
      searchNearbyBooks({
        lat: userLocation!.lat,
        lng: userLocation!.lng,
        category: selectedCategory ?? undefined,
        q: searchText || undefined,
      }),
    enabled: !!userLocation,
  });
  const books = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Home</Text>
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
          value={searchText}
          onChangeText={setSearchText}
          testID="search-input"
        />
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
            message="Kitap bulunamadı"
            description="Yakınlarda takas için kitap yok"
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
  },
  chipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  scrollContent: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
  },
});
