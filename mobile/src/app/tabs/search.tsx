import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { BookCard, EmptyState, Input, Skeleton, palette, spacing, fontSize } from '@/components/ui';
import { searchNearbyBooks } from '@/lib/api/client';

const CATEGORIES = [
  { value: 'fiction', label: 'Kurgu' },
  { value: 'non_fiction', label: 'Kurgu Dışı' },
  { value: 'textbook', label: 'Ders Kitabı' },
  { value: 'children', label: 'Çocuk' },
  { value: 'comics', label: 'Çizgi Roman' },
  { value: 'poetry', label: 'Şiir' },
  { value: 'other', label: 'Diğer' },
];

const CONDITIONS = [
  { value: 'new', label: 'Yeni' },
  { value: 'like_new', label: 'Yeni Gibi' },
  { value: 'good', label: 'İyi' },
  { value: 'worn', label: 'Yıpranmış' },
];

export default function SearchScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);

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
    queryKey: ['books', 'search', userLocation?.lat, userLocation?.lng, query, selectedCategory, selectedCondition],
    queryFn: () =>
      searchNearbyBooks({
        lat: userLocation!.lat,
        lng: userLocation!.lng,
        q: query || undefined,
        category: selectedCategory || undefined,
        condition: selectedCondition || undefined,
      }),
    enabled: !!userLocation,
  });
  const books = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
        <Input
          placeholder="Kitap veya yazar ara..."
          value={query}
          onChangeText={setQuery}
          testID="search-input"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { backgroundColor: colors.surface }]}
        contentContainerStyle={styles.filterContent}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.value}
            style={[
              styles.filterChip,
              { borderColor: colors.textMuted },
              selectedCategory === cat.value && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
          >
            <Text
              style={[
                styles.filterChipText,
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
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { backgroundColor: colors.surface }]}
        contentContainerStyle={styles.filterContent}
      >
        {CONDITIONS.map((cond) => (
          <TouchableOpacity
            key={cond.value}
            style={[
              styles.filterChip,
              { borderColor: colors.textMuted },
              selectedCondition === cond.value && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => setSelectedCondition(selectedCondition === cond.value ? null : cond.value)}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: colors.text },
                selectedCondition === cond.value && { color: '#fff' },
              ]}
            >
              {cond.label}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  filterRow: {
    maxHeight: 50,
  },
  filterContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: fontSize.bodySm,
  },
  scrollContent: {
    padding: spacing.lg,
  },
});
