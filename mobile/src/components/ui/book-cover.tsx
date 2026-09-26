import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { palette } from './tokens';

export interface BookCoverProps {
  /** Remote cover URL. When null/undefined/empty, shows a fallback icon. */
  url?: string | null;
  /** Width in px. Default 64. */
  size?: number;
  /** Border radius. Default 8. */
  radius?: number;
}

export function BookCover({ url, size = 64, radius = 8 }: BookCoverProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const hasUrl = typeof url === 'string' && url.length > 0;

  if (!hasUrl) {
    return (
      <View
        testID="book-cover-fallback"
        style={[
          styles.fallback,
          {
            width: size,
            height: size * 1.5,
            borderRadius: radius,
            backgroundColor: colors.textMuted + '20',
          },
        ]}
      >
        <Ionicons name="book-outline" size={size * 0.4} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      testID="book-cover-image"
      source={{ uri: url }}
      style={{ width: size, height: size * 1.5, borderRadius: radius }}
      contentFit="cover"
      transition={200}
      cachePolicy="memory-disk"
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
