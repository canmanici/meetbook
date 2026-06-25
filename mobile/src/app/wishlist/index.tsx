import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Input, EmptyState, Skeleton, Badge, palette, spacing, radius, fontSize, shadows } from '@/components/ui';
import { getWishlist, addToWishlist, removeFromWishlist, getWishlistMatches, WishlistItem } from '@/lib/api/client';

export default function WishlistScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

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
      setAuthor('');
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

  const hasMatch = (itemIsbn: string): boolean => {
    return matches.some((m) => m.isbn === itemIsbn);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.textMuted + '15' }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>İstek Listesi</Text>
      </View>

      <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
        <Input
          placeholder="Kitap adı veya ISBN"
          value={isbn}
          onChangeText={setIsbn}
          style={styles.searchInput}
          testID="wishlist-search-input"
        />
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            if (isbn.trim()) {
              addMutation.mutate({
                isbn: isbn.trim(),
                title: title.trim() || undefined,
                author: author.trim() || undefined,
              });
            }
          }}
          disabled={!isbn.trim() || addMutation.isPending}
          testID="wishlist-add-button"
        >
          <Ionicons name="add" size={24} color={colors.surface} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {wishlistLoading || matchesLoading ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            message="İstek listesi boş"
            description="Kitap eklemek için yukarıdaki alana ISBN veya kitap adı yazın"
          />
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Kitaplarım</Text>
            {items.map((item) => (
              <View
                key={item.id}
                style={[styles.wishlistCard, { backgroundColor: colors.surface }]}
                testID={`wishlist-card-${item.id}`}
              >
                <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]}>
                  <Ionicons name="book-outline" size={24} color={colors.textMuted} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.title || item.isbn}
                  </Text>
                  {item.author && (
                    <Text style={[styles.cardAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.author}
                    </Text>
                  )}
                  <View style={styles.statusRow}>
                    {hasMatch(item.isbn) ? (
                      <View style={[styles.statusBadge, { backgroundColor: colors.success + '20' }]}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={[styles.statusText, { color: colors.success }]}>Eşleşme bulundu</Text>
                      </View>
                    ) : (
                      <View style={[styles.statusBadge, { backgroundColor: colors.warning + '20' }]}>
                        <Ionicons name="time-outline" size={14} color={colors.warning} />
                        <Text style={[styles.statusText, { color: colors.warning }]}>Bekleniyor</Text>
                      </View>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.removeButton, { backgroundColor: colors.danger + '15' }]}
                  onPress={() => removeMutation.mutate(item.id)}
                  testID={`wishlist-remove-${item.id}`}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}

            {matches.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Yakınınızda Eşleşenler</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.matchesScroll}
                >
                  {matches.map((match) => (
                    <TouchableOpacity
                      key={match.id}
                      style={[styles.matchCard, { backgroundColor: colors.surface }]}
                      onPress={() => router.push(`/book/${match.id}`)}
                      testID={`match-card-${match.id}`}
                    >
                      <View style={[styles.matchCover, { backgroundColor: colors.textMuted + '30' }]}>
                        {match.photos?.[0]?.url ? (
                          <Image
                            source={{ uri: match.photos[0].url }}
                            style={styles.matchCoverImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons name="book-outline" size={20} color={colors.textMuted} />
                        )}
                        <View style={[styles.distanceBadge, { backgroundColor: colors.primary }]}>
                          <Text style={styles.distanceBadgeText}>{match.distance_km.toFixed(1)} km</Text>
                        </View>
                      </View>
                      <View style={styles.matchInfo}>
                        <Text style={[styles.matchTitle, { color: colors.text }]} numberOfLines={1}>
                          {match.title}
                        </Text>
                        {match.author && (
                          <Text style={[styles.matchAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                            {match.author}
                          </Text>
                        )}
                        <TouchableOpacity
                          style={[styles.exchangeButton, { backgroundColor: colors.primary }]}
                          onPress={() => router.push(`/book/${match.id}`)}
                          testID={`exchange-request-${match.id}`}
                        >
                          <Text style={styles.exchangeButtonText}>Takas İste</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    marginBottom: 0,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: radius.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  wishlistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  cover: {
    width: 48,
    height: 64,
    borderRadius: radius.input,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardAuthor: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  matchesScroll: {
    paddingRight: spacing.lg,
  },
  matchCard: {
    width: 160,
    borderRadius: radius.input,
    marginRight: spacing.sm,
    overflow: 'hidden',
    ...shadows.card,
  },
  matchCover: {
    width: '100%',
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchCoverImage: {
    width: '100%',
    height: '100%',
  },
  distanceBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  distanceBadgeText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  matchInfo: {
    padding: spacing.sm,
  },
  matchTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: 2,
  },
  matchAuthor: {
    fontSize: fontSize.caption,
    marginBottom: spacing.sm,
  },
  exchangeButton: {
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  exchangeButtonText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});