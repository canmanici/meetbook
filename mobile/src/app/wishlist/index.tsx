import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { BookCard, EmptyState, Input, Skeleton, palette, spacing, fontSize } from '@/components/ui';
import { getWishlist, addToWishlist, removeFromWishlist, getWishlistMatches } from '@/lib/api/client';

export default function WishlistScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: wishlistData, isLoading: wishlistLoading } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
  });

  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ['wishlist-matches'],
    queryFn: getWishlistMatches,
  });

  const addMutation = useMutation({
    mutationFn: addToWishlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-matches'] });
      setIsbn('');
      setTitle('');
      setShowAddForm(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeFromWishlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-matches'] });
    },
  });

  const items = wishlistData?.items ?? [];
  const matches = matchesData?.matches ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          İstek Listesi
        </Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setShowAddForm(!showAddForm)}
        >
          <Text style={styles.addButtonText}>{showAddForm ? 'İptal' : '+ Ekle'}</Text>
        </TouchableOpacity>
      </View>

      {showAddForm && (
        <View style={[styles.addForm, { backgroundColor: colors.surface, borderBottomColor: colors.textMuted }]}>
          <Input
            placeholder="ISBN (örn: 9789753425582)"
            value={isbn}
            onChangeText={setIsbn}
            testID="wishlist-isbn-input"
          />
          <Input
            placeholder="Kitap adı (isteğe bağlı)"
            value={title}
            onChangeText={setTitle}
            testID="wishlist-title-input"
          />
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (isbn.trim()) {
                addMutation.mutate({ isbn: isbn.trim(), title: title.trim() || undefined });
              }
            }}
            disabled={!isbn.trim() || addMutation.isPending}
          >
            <Text style={styles.submitButtonText}>
              {addMutation.isPending ? 'Ekleniyor...' : 'Ekle'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {wishlistLoading || matchesLoading ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            message="İstek listesi boş"
            description="Kitap eklemek için + butonuna tıklayın"
          />
        ) : (
          <>
            {items.map((item) => (
              <View key={item.id} style={[styles.wishlistItem, { backgroundColor: colors.surface }]}>
                <View style={styles.itemInfo}>
                  <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title || item.isbn}</Text>
                  {item.author && <Text style={[styles.itemAuthor, { color: colors.textMuted }]}>{item.author}</Text>}
                  <Text style={[styles.itemIsbn, { color: colors.textMuted }]}>ISBN: {item.isbn}</Text>
                </View>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeMutation.mutate(item.id)}
                >
                  <Text style={styles.removeButtonText}>Sil</Text>
                </TouchableOpacity>
              </View>
            ))}

            {matches.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Eşleşen Kitaplar ({matches.length})
                </Text>
                {matches.map((match) => (
                  <BookCard
                    key={match.id}
                    title={match.title}
                    author={match.author ?? ''}
                    condition={match.condition as any}
                    distanceKm={match.distance_km}
                    coverUrl={match.photos?.[0]?.url}
                    onPress={() => router.push(`/book/${match.id}`)}
                    testID={`match-card-${match.id}`}
                  />
                ))}
              </>
            )}
          </>
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
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  addButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  addForm: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  submitButton: {
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  wishlistItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  itemAuthor: {
    fontSize: fontSize.bodySm,
    marginTop: 2,
  },
  itemIsbn: {
    fontSize: fontSize.caption,
    marginTop: 4,
  },
  removeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#ff4444',
    borderRadius: 6,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
