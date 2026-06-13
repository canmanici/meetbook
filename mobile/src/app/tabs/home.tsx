import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { BookCard, EmptyState, Skeleton, palette, spacing, fontSize } from '@/components/ui';
import { searchNearbyBooks } from '@/lib/api/client';

export default function HomeScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

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
    queryKey: ['books', 'nearby', userLocation?.lat, userLocation?.lng],
    queryFn: () => searchNearbyBooks({ lat: userLocation!.lat, lng: userLocation!.lng }),
    enabled: !!userLocation,
  });
  const books = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Yakınlardaki Kitaplar
        </Text>
      </View>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
  },
});
