import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { palette, spacing, fontSize, radius, shadows } from './tokens';
import type { MessageView } from '@/lib/api/chat';

const BOOK_CATEGORY_LABELS: Record<string, string> = {
  fiction: 'Roman',
  non_fiction: 'Popüler Bilim',
  textbook: 'Ders Kitabı',
  comics: 'Çizgi Roman',
  children: 'Çocuk',
  poetry: 'Şiir',
  other: 'Diğer',
};

interface BookCardMessageProps {
  message: MessageView;
  isMine: boolean;
}

export const BookCardMessage: React.FC<BookCardMessageProps> = ({ message, isMine }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const router = useRouter();

  const bookId = message.extra?.book_id;
  const title = message.extra?.title || 'Kitap';
  const author = message.extra?.author;
  const coverUrl = message.extra?.cover_url;
  const category = message.extra?.category;

  const handlePress = () => {
    if (bookId) {
      router.push(`/book/${bookId}`);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        shadows.card,
      ]}
    >
      {/* Cover */}
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.coverPlaceholder, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="book" size={24} color={colors.primary} />
        </View>
      )}

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {author && (
          <Text style={[styles.author, { color: colors.textMuted }]} numberOfLines={1}>
            {author}
          </Text>
        )}
        {category && (
          <View style={[styles.categoryBadge, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.categoryText, { color: colors.primary }]}>
              {BOOK_CATEGORY_LABELS[category] ?? category}
            </Text>
          </View>
        )}
      </View>

      {/* Arrow */}
      <View style={styles.arrow}>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    maxWidth: 280,
  },
  cover: {
    width: 60,
    height: 80,
    backgroundColor: '#e0e0e0',
  },
  coverPlaceholder: {
    width: 60,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    padding: spacing.sm,
    gap: 4,
  },
  title: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    lineHeight: 18,
  },
  author: {
    fontSize: fontSize.caption,
    lineHeight: 16,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
  },
  arrow: {
    paddingRight: spacing.sm,
  },
});
