import React, { useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { palette, spacing, fontSize, radius } from "../ui/tokens";

export interface PreviewBook {
  id: string;
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  distanceKm: number;
  ownerName: string;
  isFavorited: boolean;
}

interface MarkerPreviewCardProps {
  book: PreviewBook;
  onFavoriteToggle?: (bookId: string) => void;
  onRequestExchange?: (bookId: string) => void;
  onNavigateToDetail?: (bookId: string) => void;
  style?: ViewStyle;
}

function MarkerPreviewCard({
  book,
  onFavoriteToggle,
  onRequestExchange,
  onNavigateToDetail,
  style,
}: MarkerPreviewCardProps) {
  const handleFavorite = useCallback(() => {
    onFavoriteToggle?.(book.id);
  }, [book.id, onFavoriteToggle]);

  const handleExchange = useCallback(() => {
    onRequestExchange?.(book.id);
  }, [book.id, onRequestExchange]);

  const handleDetail = useCallback(() => {
    onNavigateToDetail?.(book.id);
  }, [book.id, onNavigateToDetail]);

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={handleDetail}
      activeOpacity={0.9}
    >
      <BlurView intensity={80} tint="dark" style={styles.blur}>
        <View style={styles.content}>
          <View style={styles.coverContainer}>
            {book.coverUrl ? (
              <Image
                source={{ uri: book.coverUrl }}
                style={styles.cover}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>
                  {book.title.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author ? (
              <Text style={styles.author} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
            <View style={styles.meta}>
              <Text style={styles.distance}>
                {book.distanceKm < 1
                  ? `${Math.round(book.distanceKm * 1000)} m`
                  : `${book.distanceKm.toFixed(1)} km`}
              </Text>
              <Text style={styles.owner}>{book.ownerName}</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.favoriteButton}
              onPress={handleFavorite}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.favoriteIcon}>
                {book.isFavorited ? "❤️" : "🤍"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.exchangeButton}
              onPress={handleExchange}
            >
              <Text style={styles.exchangeButtonText}>Takas İste</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  blur: {
    borderRadius: radius.card,
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    padding: spacing.md,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  coverContainer: {
    width: 56,
    height: 84,
    borderRadius: radius.input,
    overflow: "hidden",
    marginRight: spacing.md,
  },
  cover: {
    width: 56,
    height: 84,
  },
  placeholder: {
    width: 56,
    height: 84,
    backgroundColor: palette.light.surfaceAlt,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: palette.light.textMuted,
  },
  info: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  author: {
    fontSize: fontSize.caption,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  distance: {
    fontSize: fontSize.caption,
    color: palette.light.primary,
    marginRight: spacing.sm,
  },
  owner: {
    fontSize: fontSize.caption,
    color: "rgba(255,255,255,0.5)",
  },
  actions: {
    justifyContent: "center",
    alignItems: "center",
    marginLeft: spacing.sm,
  },
  favoriteButton: {
    marginBottom: spacing.xs,
  },
  favoriteIcon: {
    fontSize: 20,
  },
  exchangeButton: {
    backgroundColor: palette.light.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.input,
  },
  exchangeButtonText: {
    fontSize: fontSize.caption,
    color: "#FFFFFF",
    fontWeight: "600",
  },
});

export default MarkerPreviewCard;
