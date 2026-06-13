import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { BookCard, Button, Card, EmptyState, Skeleton, palette, spacing, fontSize } from '@/components/ui';
import { listMyBooks } from '@/lib/api/client';

export default function MyBooksScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({
    queryKey: ['books', 'me'],
    queryFn: () => listMyBooks(),
  });
  const books = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kitaplarım</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.addButtonRow}>
          <Button onPress={() => router.push('/book/new')} variant="secondary">
            + Kitap ekle
          </Button>
        </View>
        {isLoading ? (
          <>
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </>
        ) : books.length === 0 ? (
          <EmptyState
            message="Henüz kitap eklenmedi"
            description="Kitap ekleyerek takasa başlayın"
            actionLabel="+ Kitap ekle"
            onAction={() => router.push('/book/new')}
          />
        ) : (
          books.map((book) => (
            <BookCard
              key={book.id}
              title={book.title}
              author={book.author ?? ''}
              condition={book.condition as any}
              category={(book.category as string) ?? ''}
              coverUrl={book.photos?.[0]?.url}
              onPress={() => router.push(`/book/${book.id}`)}
              testID={`my-book-${book.id}`}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  addButtonRow: {
    marginBottom: spacing.md,
  },
});
