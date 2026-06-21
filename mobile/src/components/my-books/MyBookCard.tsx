import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, radius, fontSize } from '@/components/ui/tokens';
import { categoryLabel, conditionLabel, timeAgo, formatStats } from '@/lib/format';

interface MyBookCardProps {
  id: string;
  title: string;
  author: string | null;
  coverUrl?: string;
  category: string;
  condition: string;
  language: string;
  description: string | null;
  viewCount: number;
  favoriteCount: number;
  createdAt: string;
  isAvailable: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function MyBookCard({
  title,
  author,
  coverUrl,
  category,
  condition,
  language,
  description,
  viewCount,
  favoriteCount,
  createdAt,
  isAvailable,
  onPress,
  onLongPress,
}: MyBookCardProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [imageError, setImageError] = useState(false);

  const hasCover = !!coverUrl && !imageError;
  const statsStr = formatStats(viewCount, favoriteCount);

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.7}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${author ?? 'bilinmeyen yazar'}, ${categoryLabel(category)}, ${conditionLabel(condition)}, ${language}, ${statsStr}, ${timeAgo(createdAt)} eklendi`}
      accessibilityHint="Hızlı işlemler için basılı tutun"
    >
      {/* Cover */}
      <View style={styles.coverWrap}>
        {hasCover ? (
          <Image
            source={{ uri: coverUrl }}
            style={[styles.cover, { shadowColor: colors.text }]}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="book-outline" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={[styles.statusDot, { backgroundColor: isAvailable ? colors.success : colors.textMuted }]} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>
          {author ?? 'Bilinmeyen yazar'}
        </Text>

        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: colors.primary + '15' }]}>
            <View style={[styles.pillDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.pillText, { color: colors.primary }]}>
              {categoryLabel(category)}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.pillText, { color: colors.textMuted }]}>
              {conditionLabel(condition)}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: colors.info + '15' }]}>
            <Text style={[styles.pillText, { color: colors.info }]}>
              {language.toUpperCase()}
            </Text>
          </View>
        </View>

        {description ? (
          <Text style={[styles.desc, { color: colors.textMuted }]} numberOfLines={1}>
            {description}
          </Text>
        ) : null}

        {statsStr ? (
          <View style={styles.statsRow}>
            <Text style={[styles.statsText, { color: colors.textMuted }]} numberOfLines={1}>
              {statsStr}
            </Text>
            <View style={[styles.statsDot, { backgroundColor: colors.textMuted }]} />
            <Text style={[styles.statsText, { color: colors.textMuted }]}>
              {timeAgo(createdAt)}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.md,
    minHeight: 120,
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  coverWrap: {
    position: 'relative',
    marginRight: spacing.md,
  },
  cover: {
    width: 56,
    height: 80,
    borderRadius: radius.field,
    shadowOffset: { width: 3, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  coverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0,
    elevation: 0,
  },
  statusDot: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '800',
    lineHeight: 20,
  },
  author: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  desc: {
    fontSize: fontSize.caption,
    lineHeight: 14,
    marginTop: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  statsText: {
    fontSize: 10,
    fontWeight: '500',
  },
  statsDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
});
