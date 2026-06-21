import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, radius } from '@/components/ui/tokens';
import { conditionLabel } from '@/lib/format';

interface MyBookGridTileProps {
  id: string;
  title: string;
  author: string | null;
  coverUrl?: string;
  condition: string;
  onPress: () => void;
  onLongPress: () => void;
}

export function MyBookGridTile({
  title,
  author,
  coverUrl,
  condition,
  onPress,
  onLongPress,
}: MyBookGridTileProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [imageError, setImageError] = useState(false);

  const hasCover = !!coverUrl && !imageError;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.8}
      style={styles.tile}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${author ?? 'bilinmeyen yazar'}`}
      accessibilityHint="Hızlı işlemler için basılı tutun"
    >
      {hasCover ? (
        <Image
          source={{ uri: coverUrl }}
          style={styles.cover}
          resizeMode="cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="book-outline" size={32} color={colors.textMuted} />
        </View>
      )}

      <View style={[styles.badge, { backgroundColor: '#fff' }]}>
        <Text style={[styles.badgeText, { color: colors.text }]}>
          {conditionLabel(condition)}
        </Text>
      </View>

      <LinearGradient
        colors={['transparent', isDark ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.75)']}
        style={styles.overlay}
      >
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {author ? (
          <Text style={styles.author} numberOfLines={1}>
            {author}
          </Text>
        ) : null}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '48%',
    aspectRatio: 0.65,
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
    borderRadius: radius.card,
  },
  coverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    zIndex: 2,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 15,
  },
  author: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
});
