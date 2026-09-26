import React, { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { palette, radius, spacing, fontSize } from '@/components/ui';

const MAIN_WIDTH = 200;
const MAIN_HEIGHT = 280;
const THUMB_WIDTH = 60;
const THUMB_HEIGHT = 80;

interface Photo {
  id: string;
  url: string;
  position: number;
}

interface PhotoGalleryProps {
  photos: Photo[];
}

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [activeIndex, setActiveIndex] = useState(0);

  if (photos.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.gallery}>
        {/* Main photo */}
        <Image
          source={{ uri: photos[activeIndex]?.url }}
          style={[styles.mainPhoto, { borderColor: colors.textMuted }]}
          resizeMode="cover"
        />

        {/* Thumbnails */}
        {photos.length > 1 && (
          <ScrollView
            style={styles.thumbnails}
            contentContainerStyle={styles.thumbnailsContent}
            showsVerticalScrollIndicator={false}>
            {photos.map((photo, index) => (
              <Pressable key={photo.id} onPress={() => setActiveIndex(index)}>
                <Image
                  source={{ uri: photo.url }}
                  style={[
                    styles.thumbnail,
                    {
                      borderColor: index === activeIndex ? colors.primary : colors.textMuted,
                      opacity: index === activeIndex ? 1 : 0.6,
                    },
                  ]}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Position indicator */}
      <Text style={[styles.indicator, { color: colors.textMuted }]}>
        {activeIndex + 1}/{photos.length}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  gallery: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mainPhoto: {
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  thumbnails: {
    flex: 1,
    maxHeight: MAIN_HEIGHT,
  },
  thumbnailsContent: {
    gap: spacing.xs,
  },
  thumbnail: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  indicator: {
    fontSize: fontSize.bodySm,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
