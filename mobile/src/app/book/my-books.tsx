import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { BookCard, Button, EmptyState, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { listMyBooks } from '@/lib/api/client';

type BookTab = 'active' | 'completed';

export default function MyBooksScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<BookTab>('active');

  const { data, isLoading } = useQuery({
    queryKey: ['books', 'me'],
    queryFn: () => listMyBooks(),
  });
  const allBooks = data?.items ?? [];
  const activeBooks = allBooks.filter((book) => book.is_available);
  const completedBooks = allBooks.filter((book) => !book.is_available);
  const books = activeTab === 'active' ? activeBooks : completedBooks;

  const tabs: { key: BookTab; label: string; count: number }[] = [
    { key: 'active', label: 'Aktif', count: activeBooks.length },
    { key: 'completed', label: 'Takas Edilen', count: completedBooks.length },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kitaplarım</Text>
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[
                  styles.tab,
                  isActive
                    ? { backgroundColor: colors.primary }
                    : { borderColor: colors.primary, borderWidth: 1 },
                ]}
                testID={`my-books-tab-${tab.key}`}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? colors.surface : colors.primary },
                  ]}
                >
                  {tab.label} ({tab.count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
          activeTab === 'active' ? (
            <EmptyState
              message="Henüz kitap eklenmedi"
              description="Kitap ekleyerek takasa başlayın"
              actionLabel="+ Kitap ekle"
              onAction={() => router.push('/book/new')}
            />
          ) : (
            <EmptyState
              message="Henüz takas edilen kitap yok"
              description="Tamamlanan takaslar burada görünecek"
            />
          )
        ) : (
          books.map((book) => (
            <View key={book.id} style={activeTab === 'completed' ? styles.completedCard : undefined}>
              <BookCard
                title={book.title}
                author={book.author ?? ''}
                condition={book.condition as any}
                category={(book.category as string) ?? ''}
                coverUrl={book.photos?.[0]?.url}
                onPress={() => router.push(`/book/${book.id}`)}
                testID={`my-book-${book.id}`}
              />
            </View>
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
    gap: spacing.md,
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
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  tabText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  addButtonRow: {
    marginBottom: spacing.md,
  },
  completedCard: {
    opacity: 0.6,
  },
});
