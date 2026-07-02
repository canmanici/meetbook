import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  useColorScheme,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, spacing, radius, fontSize, shadows } from './tokens';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
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
  onBookDetail?: () => void;
  onFavorite?: () => void;
  style?: ViewStyle;
  testID?: string;
}

export const conditionLabels: Record<BookCondition, string> = {
  'new': 'Yeni',
  'like-new': 'Yeni gibi',
  'good': 'İyi',
  'fair': 'İdare eder',
  'poor': 'Kötü',
};

const conditionColorKeys: Record<BookCondition, keyof typeof palette.light> = {
  'new': 'success',
  'like-new': 'success',
  'good': 'primary',
  'fair': 'warning',
  'poor': 'danger',
};

export const BookCard: React.FC<BookCardProps> = ({
  title,
  author,
  coverUrl,
  condition,
  category,
  distanceKm,
  onPress,
  onBookDetail,
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

  const conditionColor = colors[conditionColorKeys[condition]];

  const handleImageError = () => {
    setImageError(true);
  };

  const hasCover = coverUrl && !imageError;
  const coverFailed = coverUrl && imageError;

  const conditionTint = conditionColor + '1F';

  return (
    <CardWrapper style={[styles.bookCard, { backgroundColor: colors.surface, borderColor: colors.border }, style]} {...wrapperProps}>
      {typeof distanceKm === 'number' && (
        <View style={[styles.distanceBadge, { backgroundColor: colors.surface }]} testID="distance-badge">
          <Ionicons name="location" size={11} color={colors.primary} />
          <Text style={[styles.distanceBadgeText, { color: colors.text }]}>{distanceKm.toFixed(1)} km</Text>
        </View>
      )}
      <View style={styles.bookCardInner}>
        <View style={styles.coverWrap}>
          <View style={[styles.coverShadow, { shadowColor: colors.text }]}>
            {hasCover ? (
              <Image
                source={{ uri: coverUrl }}
                style={styles.cover}
                resizeMode="cover"
                testID="book-cover"
                onError={handleImageError}
              />
            ) : coverFailed ? (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.surfaceAlt }]} testID="book-cover-error">
                <Ionicons name="book-outline" size={28} color={colors.textMuted} />
              </View>
            ) : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.surfaceAlt }]} testID="book-cover-placeholder">
                <Ionicons name="book-outline" size={28} color={colors.textMuted} />
              </View>
            )}
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.textSection}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{title}</Text>
            <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>{author}</Text>
          </View>

          <View style={styles.tagsRow}>
            <View style={[styles.tag, { backgroundColor: conditionTint }]} testID="condition-tag">
              <View style={[styles.dot, { backgroundColor: conditionColor }]} />
              <Text style={[styles.tagText, { color: conditionColor }]}>{conditionLabels[condition]}</Text>
            </View>
            {category ? (
              <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]} testID="category-tag">
                <Text style={[styles.tagText, { color: colors.textMuted }]} numberOfLines={1}>{category}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onBookDetail}
              testID="book-detail-button"
              style={styles.exchangeButtonWrap}
            >
              <LinearGradient
                colors={[colors.primary, '#0D5E4F']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.exchangeButton}
              >
                <Ionicons name="arrow-forward" size={16} color="#fff" />
                <Text style={styles.exchangeButtonText}>kitaba git</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.favoriteButton, { backgroundColor: colors.surfaceAlt }]}
              onPress={onFavorite}
              activeOpacity={0.6}
              testID="favorite-button"
            >
              <Ionicons name="heart-outline" size={20} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </CardWrapper>
  );
};

const styles = StyleSheet.create({
  bookCard: {
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    position: 'relative',
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  bookCardInner: {
    flexDirection: 'row',
  },
  coverWrap: {
    marginRight: spacing.md,
  },
  coverShadow: {
    borderRadius: radius.field + 2,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 15,
  },
  cover: {
    width: 72,
    height: 128,
    borderRadius: radius.field,
    borderWidth: 0,
  },
  coverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  distanceBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    zIndex: 10,
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  distanceBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  textSection: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '800',
    marginBottom: 3,
    lineHeight: 21,
  },
  author: {
    fontSize: 13,
    fontWeight: '500',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tagText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  exchangeButtonWrap: {
    flex: 1,
    borderRadius: radius.button,
    shadowColor: '#0A4D42',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 80,
  },
  exchangeButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: spacing.sm + 3,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exchangeButtonText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  favoriteButton: {
    width: 42,
    height: 42,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 60,
    elevation: 4,
  },
});
