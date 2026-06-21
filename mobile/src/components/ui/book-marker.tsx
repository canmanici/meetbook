import React, { useState, useRef, useEffect } from 'react';
import { View, Image, StyleSheet, Text, Platform } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { moderateScale } from 'react-native-size-matters';

interface BookMarkerProps {
  coordinate: { latitude: number; longitude: number };
  coverUrl?: string;
  thumbnailUrl?: string;
  title: string;
  onPress?: () => void;
}

const MARKER_WIDTH = moderateScale(46);
const MARKER_HEIGHT = moderateScale(62);

/**
 * Custom marker using the `icon` prop on Android to bypass the 40px bitmap
 * clipping issue. `scaledSize` tells the native renderer the exact pixel
 * dimensions to allocate for the marker bitmap.
 *
 * Title is rendered inside a tooltip Callout (tap to reveal).
 */
export function BookMarker({ coordinate, coverUrl, thumbnailUrl, title, onPress }: BookMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const tracksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    tracksTimerRef.current = setTimeout(() => setTracksViewChanges(false), 2000);
    return () => {
      if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    };
  }, []);

  // Prefer thumbnail for markers (pre-sized 80×45), fall back to full cover
  const markerUri = thumbnailUrl || coverUrl;

  const markerIcon = markerUri
    ? { uri: markerUri, width: MARKER_WIDTH, height: MARKER_HEIGHT, scale: 1 }
    : undefined;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      {...(Platform.OS === 'android' && markerIcon ? { icon: markerIcon } : {})}
    >
      {/* iOS: render children as before. Android: icon prop wins, children ignored. */}
      {Platform.OS === 'ios' && (
        <View style={styles.wrapper}>
          <View style={styles.box}>
            {markerUri ? (
              <Image
                source={{ uri: markerUri }}
                style={styles.cover}
                resizeMode="cover"
                onLoad={() => setTracksViewChanges(false)}
                onError={() => setTracksViewChanges(false)}
              />
            ) : (
              <View
                style={[styles.cover, styles.placeholder]}
                onLayout={() => setTracksViewChanges(false)}
              />
            )}
          </View>
        </View>
      )}

      <Callout tooltip onPress={onPress}>
        <View style={styles.calloutContainer}>
          <View style={styles.calloutBubble}>
            <Text style={styles.calloutText} numberOfLines={1} ellipsizeMode="tail">
              {title || 'Untitled'}
            </Text>
          </View>
          <View style={styles.calloutArrow} />
        </View>
      </Callout>
    </Marker>
  );
}

const styles = StyleSheet.create({
  /* iOS children fallback */
  wrapper: {
    alignItems: 'center',
  },
  box: {
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT,
    borderRadius: moderateScale(16),
    backgroundColor: '#FFF',
    padding: moderateScale(3),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  cover: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: moderateScale(13),
    backgroundColor: '#000',
  },
  placeholder: {
    backgroundColor: '#333',
  },
  /* Callout tooltip */
  calloutContainer: {
    alignItems: 'center',
    width: moderateScale(140),
  },
  calloutBubble: {
    backgroundColor: '#FFF',
    paddingVertical: moderateScale(6),
    paddingHorizontal: moderateScale(10),
    borderRadius: moderateScale(8),
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  calloutText: {
    color: '#1A1A1A',
    fontSize: moderateScale(13),
    fontWeight: '700',
    textAlign: 'center',
  },
  calloutArrow: {
    marginTop: -1,
    width: 0,
    height: 0,
    borderLeftWidth: moderateScale(6),
    borderRightWidth: moderateScale(6),
    borderTopWidth: moderateScale(8),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFF',
  },
});
