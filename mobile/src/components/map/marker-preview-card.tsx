/**
 * MarkerPreviewCard — spec §3.5 marker-tap preview card.
 *
 * Slides up over the bottom sheet (220ms reanimated spring) when a marker is tapped.
 * Shows: cover (64×88), title, author, badges (distance/category/condition/fresh),
 * 2-line description, owner row (avatar initials, name, book_count, rating),
 * two actions: Favori (ghost) / Takas İste (primary).
 *
 * Gestures:
 *   swipe down → close card
 *   swipe up   → navigate to /book/[id]
 *
 * API calls (internal):
 *   Favori     → POST /books/{id}/favorite (or DELETE if favorited) + toast + haptic Medium
 *   Takas İste → POST /exchanges + toast on 201/409 + haptic Medium/Warning + close on success
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, type ThemeColors } from '../ui/tokens';
import { BookCover } from '../ui/book-cover';
import { useToast } from '@/hooks/use-toast';
import { useFavoritesStore } from '@/stores/favorites';
import { addFavorite, removeFavorite, createExchange } from '@/lib/api/client';
import { exchangeRequestError } from '@/lib/exchange-errors';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PreviewBook {
  id: string;
  title: string;
  author?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  category?: string;
  condition?: string;
  distanceKm: number;
  ownerId: string;
  ownerName: string;
  ownerBookCount?: number;
  ownerRatingAvg?: number | null;
  ownerRatingCount?: number;
  isFavorited: boolean;
  createdAt?: string;
}

interface MarkerPreviewCardProps {
  book: PreviewBook;
  onClose: () => void;
  onNavigateToDetail: (bookId: string) => void;
  peekHeightPx: number;
  insetsBottom: number;
  colors: ThemeColors;
  isDark: boolean;
  testID?: string;
}

// ── Label maps ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  fiction: 'Roman',
  non_fiction: 'Popüler Bilim',
  textbook: 'Ders Kitabı',
  comics: 'Çizgi Roman',
  children: 'Çocuk',
  poetry: 'Şiir',
  other: 'Diğer',
};

const CONDITION_LABELS: Record<string, string> = {
  new: 'Yeni',
  like_new: 'Çok İyi',
  good: 'İyi',
  fair: 'Kabul Edilebilir',
  poor: 'Kötü',
};

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 500;
const COVER_W = 64;
const COVER_H = 88;

// ── Component ──────────────────────────────────────────────────────────────

function MarkerPreviewCardImpl({
  book,
  onClose,
  onNavigateToDetail,
  peekHeightPx,
  insetsBottom,
  colors,
  isDark,
  testID,
}: MarkerPreviewCardProps) {
  const toast = useToast();
  const favoritesStore = useFavoritesStore();
  const [isFavorited, setIsFavorited] = useState(book.isFavorited);
  const [favLoading, setFavLoading] = useState(false);
  const [exchangeLoading, setExchangeLoading] = useState(false);

  // ── Entrance animation (220ms spring from below) ─────────────────────────
  const translateY = useSharedValue(300);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
    opacity.value = withTiming(1, { duration: 220 });
  }, [translateY, opacity]);

  // ── Swipe gestures ────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > SWIPE_THRESHOLD || e.velocityY > SWIPE_VELOCITY) {
        // swipe down → close
        translateY.value = withTiming(300, { duration: 180 });
        opacity.value = withTiming(0, { duration: 180 });
        runOnJS(onClose)();
      } else if (e.translationY < -SWIPE_THRESHOLD || e.velocityY < -SWIPE_VELOCITY) {
        // swipe up → navigate to detail
        translateY.value = withTiming(-50, { duration: 150 });
        opacity.value = withTiming(0, { duration: 150 });
        runOnJS(onNavigateToDetail)(book.id);
      } else {
        // snap back
        translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  // ── Favorite toggle (API + store + toast + haptic) ────────────────────────
  const handleFavorite = useCallback(async () => {
    if (favLoading) return;
    setFavLoading(true);
    const wasFavorited = isFavorited;
    setIsFavorited(!wasFavorited); // optimistic

    try {
      if (wasFavorited) {
        await removeFavorite(book.id);
        favoritesStore.removeFavorite(book.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toast.show('Favorilerden çıkarıldı', { variant: 'info' });
      } else {
        await addFavorite(book.id);
        favoritesStore.addFavorite({
          bookId: book.id,
          title: book.title,
          coverUrl: book.coverUrl ?? undefined,
          ownerId: book.ownerId,
          addedAt: new Date().toISOString(),
        });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toast.show('Favorilere eklendi', { variant: 'success' });
      }
    } catch {
      setIsFavorited(wasFavorited); // revert
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('Favori işlemi başarısız', { variant: 'error' });
    } finally {
      setFavLoading(false);
    }
  }, [book, favLoading, isFavorited, favoritesStore, toast]);

  // ── Exchange request (API + toast + haptic + close on success) ───────────
  const handleExchange = useCallback(async () => {
    if (exchangeLoading) return;
    setExchangeLoading(true);
    try {
      await createExchange({
        book_id: book.id,
        initial_message: 'Merhaba, bu kitabı takas etmek isterim.',
      } as any);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      toast.show('Talep gönderildi', { variant: 'success' });
      // close preview
      translateY.value = withTiming(300, { duration: 180 });
      opacity.value = withTiming(0, { duration: 180 });
      runOnJS(onClose)();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show(exchangeRequestError(err).message, { variant: 'error', duration: 5000 });
    } finally {
      setExchangeLoading(false);
    }
  }, [book, exchangeLoading, toast, translateY, opacity, onClose]);

  // ── Derived display values ────────────────────────────────────────────────
  const categoryLabel = book.category ? CATEGORY_LABELS[book.category] ?? book.category : null;
  const conditionLabel = book.condition ? CONDITION_LABELS[book.condition] ?? book.condition : null;
  const isFresh = book.createdAt
    ? Date.now() - new Date(book.createdAt).getTime() < FRESH_WINDOW_MS
    : false;
  const distanceLabel = book.distanceKm < 1
    ? `${Math.round(book.distanceKm * 1000)} m`
    : `${book.distanceKm.toFixed(1)} km`;
  const ownerInitials = book.ownerName
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const showRating = book.ownerRatingAvg != null && (book.ownerRatingCount ?? 0) >= 3;
  const showBookCount = book.ownerBookCount != null;

  const bottom = insetsBottom + peekHeightPx + spacing.md;
  const tint = isDark ? 'dark' : 'light';

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.container,
          { bottom },
          animatedStyle,
        ]}
        testID={testID ?? 'marker-preview-card'}
      >
        <BlurView tint={tint} intensity={isDark ? 35 : 60} style={styles.blur}>
          <View style={[styles.content, { backgroundColor: isDark ? 'rgba(33,31,26,0.88)' : 'rgba(255,255,255,0.92)' }]}>
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              testID="preview-close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Top row: cover + info */}
            <View style={styles.topRow}>
              <View style={[styles.coverContainer, { borderRadius: radius.input }]}>
                {book.coverUrl ? (
                  <BookCover url={book.coverUrl} size={64} />
                ) : (
                  <View style={[styles.placeholder, { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[styles.placeholderText, { color: colors.textMuted }]}>
                      {book.title.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.info}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {book.title}
                </Text>
                {book.author ? (
                  <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>
                    {book.author}
                  </Text>
                ) : null}

                {/* Badges row */}
                <View style={styles.badges}>
                  <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.badgeText, { color: colors.primary }]}>{distanceLabel}</Text>
                  </View>
                  {categoryLabel && (
                    <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                      <Text style={[styles.badgeText, { color: colors.text }]}>{categoryLabel}</Text>
                    </View>
                  )}
                  {conditionLabel && (
                    <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                      <Text style={[styles.badgeText, { color: colors.textMuted }]}>{conditionLabel}</Text>
                    </View>
                  )}
                  {isFresh && (
                    <View style={[styles.badge, { backgroundColor: palette[isDark ? 'dark' : 'light'].accent + '30' }]}>
                      <Text style={[styles.badgeText, { color: palette[isDark ? 'dark' : 'light'].accent }]}>Yeni</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Description (2-line) */}
            {book.description ? (
              <Text style={[styles.description, { color: colors.textMuted }]} numberOfLines={2}>
                {book.description}
              </Text>
            ) : null}

            {/* Owner row */}
            <View style={styles.ownerRow}>
              <View style={[styles.ownerAvatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.ownerAvatarText}>{ownerInitials}</Text>
              </View>
              <Text style={[styles.ownerName, { color: colors.text }]} numberOfLines={1}>
                {book.ownerName}
              </Text>
              {showBookCount && (
                <Text style={[styles.ownerMeta, { color: colors.textMuted }]}>
                  · {book.ownerBookCount} kitap
                </Text>
              )}
              {showRating && (
                <Text style={[styles.ownerMeta, { color: colors.textMuted }]}>
                  · ★ {book.ownerRatingAvg!.toFixed(1)}
                </Text>
              )}
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.favBtn, { borderColor: colors.primary }]}
                onPress={handleFavorite}
                disabled={favLoading}
                testID="preview-favorite"
              >
                {favLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Ionicons
                      name={isFavorited ? 'heart' : 'heart-outline'}
                      size={18}
                      color={colors.primary}
                    />
                    <Text style={[styles.favBtnText, { color: colors.primary }]}>
                      {isFavorited ? 'Favorilerde' : 'Favori'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.goToBookBtn, { borderColor: colors.primary }]}
                onPress={() => onNavigateToDetail(book.id)}
                testID="preview-go-to-book"
              >
                <Text style={[styles.goToBookBtnText, { color: colors.primary }]}>Kitaba Git</Text>
                <Ionicons name="book-outline" size={16} color={colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exchangeBtn, { backgroundColor: colors.primary }]}
                onPress={handleExchange}
                disabled={exchangeLoading}
                testID="preview-exchange"
              >
                {exchangeLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.exchangeBtnText}>Takas İste</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Swipe hint */}
            <Text style={[styles.swipeHint, { color: colors.textMuted }]}>
              ↑ Yukarı kaydırarak detayları gör
            </Text>
          </View>
        </BlurView>
      </Animated.View>
    </GestureDetector>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.card,
    overflow: 'hidden',
    zIndex: 40,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 16 },
      android: { elevation: 10 },
    }),
  },
  blur: {
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  content: {
    padding: spacing.md,
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  topRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  coverContainer: {
    width: COVER_W,
    height: COVER_H,
    overflow: 'hidden',
  },
  cover: {
    width: COVER_W,
    height: COVER_H,
  },
  placeholder: {
    width: COVER_W,
    height: COVER_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    paddingRight: spacing.xl, // avoid close button overlap
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '700',
    lineHeight: 21,
  },
  author: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  description: {
    fontSize: fontSize.caption,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  ownerAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  ownerName: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  ownerMeta: {
    fontSize: fontSize.caption,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  favBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 2,
    flex: 1,
  },
  favBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  goToBookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 2,
    flex: 1,
  },
  goToBookBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  exchangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    flex: 1,
  },
  exchangeBtnText: {
    color: '#FFFFFF',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  swipeHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
    opacity: 0.7,
  },
});

export default MarkerPreviewCardImpl;
