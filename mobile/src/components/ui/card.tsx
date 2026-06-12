import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize, shadows } from './tokens';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const Card: React.FC<CardProps> = ({ children, style }) => {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
};

export type BookCondition = 'new' | 'like-new' | 'good' | 'fair' | 'poor';

interface BookCardProps {
  title: string;
  author: string;
  condition: BookCondition;
  distance: string;
  coverImageUrl?: string;
  onPress?: () => void;
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
  condition,
  distance,
  coverImageUrl,
  onPress,
  style,
  testID,
}) => {
  const [imageError, setImageError] = useState(false);

  const CardWrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, testID }
    : { testID };

  const handleImageError = () => {
    setImageError(true);
  };

  return (
    <CardWrapper style={[styles.bookCard, style]} {...wrapperProps}>
      {coverImageUrl && !imageError ? (
        <Image
          source={{ uri: coverImageUrl }}
          style={styles.cover}
          resizeMode="cover"
          testID="book-cover"
          onError={handleImageError}
        />
      ) : coverImageUrl && imageError ? (
        <View style={[styles.cover, styles.coverError]} testID="book-cover-error">
          <Text style={styles.coverErrorText}>?</Text>
        </View>
      ) : null}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.author}>{author}</Text>
        <View style={styles.footer}>
          <View
            style={[styles.badge, { backgroundColor: conditionColors[condition] }]}
            testID="condition-badge"
          >
            <Text style={styles.badgeText}>{conditionLabels[condition]}</Text>
          </View>
          <Text style={styles.distance}>~{distance}</Text>
        </View>
      </View>
    </CardWrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.light.surface,
    borderRadius: radius.input,
    padding: spacing.md,
    ...shadows.card,
  },
  bookCard: {
    flexDirection: 'row',
    backgroundColor: palette.light.surface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  cover: {
    width: 60,
    height: 80,
    borderRadius: radius.input,
    marginRight: spacing.md,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: palette.light.text,
    fontFamily: 'serif',
    marginBottom: spacing.xs,
  },
  author: {
    fontSize: fontSize.bodySm,
    color: palette.light.textMuted,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: palette.light.surface,
  },
  distance: {
    fontSize: fontSize.bodySm,
    color: palette.light.textMuted,
  },
  coverError: {
    backgroundColor: palette.light.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverErrorText: {
    fontSize: 24,
    fontWeight: '600',
    color: palette.light.surface,
  },
});
