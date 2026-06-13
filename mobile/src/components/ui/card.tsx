import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, radius, fontSize, shadows } from './tokens';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const Card: React.FC<CardProps> = ({ children, style }) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[{ backgroundColor: colors.surface }, style]}>
      {children}
    </View>
  );
};

export type BookCondition = 'new' | 'like-new' | 'good' | 'fair' | 'poor';

interface BookCardProps {
  title: string;
  author: string;
  coverUrl?: string;
  condition: BookCondition;
  category?: string;
  distanceKm?: number;
  onPress?: () => void;
  onRequestExchange?: () => void;
  onFavorite?: () => void;
  style?: ViewStyle;
  testID?: string;
}

const conditionLabels: Record<BookCondition, string> = {
  'new': 'Yeni',
  'like-new': 'Yeni gibi',
  'good': 'İyi',
  'fair': 'İdare eder',
  'poor': 'Kötü',
};

const conditionColors: Record<BookCondition, string> = {
  'new': palette.light.success,
  'like-new': palette.light.success,
  'good': palette.light.primary,
  'fair': palette.light.warning,
  'poor': palette.light.danger,
};

export const BookCard: React.FC<BookCardProps> = ({
  title,
  author,
  coverUrl,
  condition,
  category,
  distanceKm,
  onPress,
  onRequestExchange,
  onFavorite,
  style,
  testID,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [imageError, setImageError] = useState(false);

  const CardWrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, testID }
    : { testID };

  const handleImageError = () => {
    setImageError(true);
  };

  const hasCover = coverUrl && !imageError;
  const coverFailed = coverUrl && imageError;

  return (
    <CardWrapper style={[styles.bookCard, { backgroundColor: colors.surface }, style]} {...wrapperProps}>
      <View style={styles.bookCardInner}>
        {hasCover ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.cover}
            resizeMode="cover"
            testID="book-cover"
            onError={handleImageError}
          />
        ) : coverFailed ? (
          <View style={[styles.cover, styles.coverError]} testID="book-cover-error">
            <Ionicons name="book-outline" size={24} color={colors.surface} />
          </View>
        ) : (
          <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]} testID="book-cover-placeholder">
            <Ionicons name="book-outline" size={24} color={colors.textMuted} />
          </View>
        )}

        {typeof distanceKm === 'number' && (
          <View style={[styles.distanceBadge, { backgroundColor: colors.success }]} testID="distance-badge">
            <Text style={styles.distanceBadgeText}>{distanceKm.toFixed(1)} km</Text>
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.textSection}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
            <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>{author}</Text>
          </View>

          <View style={styles.tagsRow}>
            <View style={[styles.tag, { backgroundColor: colors.textMuted + '20' }]} testID="condition-tag">
              <Text style={[styles.tagText, { color: colors.textMuted }]}>{conditionLabels[condition]}</Text>
            </View>
            {category ? (
              <View style={[styles.tag, { backgroundColor: colors.textMuted + '20' }]} testID="category-tag">
                <Text style={[styles.tagText, { color: colors.textMuted }]} numberOfLines={1}>{category}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.exchangeButton, { backgroundColor: colors.primary }]}
              onPress={onRequestExchange}
              activeOpacity={0.7}
              testID="exchange-button"
            >
              <Text style={styles.exchangeButtonText}>exchange iste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.favoriteButton, { borderColor: colors.textMuted }]}
              onPress={onFavorite}
              activeOpacity={0.7}
              testID="favorite-button"
            >
              <Ionicons name="heart-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </CardWrapper>
  );
};

const styles = StyleSheet.create({
  bookCard: {
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  bookCardInner: {
    flexDirection: 'row',
  },
  cover: {
    width: 56,
    height: 78,
    borderRadius: radius.input,
    marginRight: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverError: {
    backgroundColor: palette.light.textMuted,
  },
  distanceBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    zIndex: 1,
  },
  distanceBadgeText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  textSection: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  author: {
    fontSize: 13,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  tagText: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  exchangeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  exchangeButtonText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  favoriteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
