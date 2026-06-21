import React, { useState, useRef, useEffect } from 'react';
import { View, Image, StyleSheet, Text, Platform } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { moderateScale } from 'react-native-size-matters';
import { pastels, type PastelName } from '@/components/ui/tokens';

interface BookMarkerProps {
  coordinate: { latitude: number; longitude: number };
  coverUrl?: string;
  thumbnailUrl?: string;
  title: string;
  onPress?: () => void;
  variant?: 'standard' | 'fresh' | 'shelf' | 'unavailable';
  selected?: boolean;
  category?: PastelName;
  stackCount?: number;
  distance?: string;
}

const MARKER_WIDTH = moderateScale(46);
const MARKER_HEIGHT = moderateScale(62);
const RING_WIDTH = moderateScale(3);
const SHELF_OFFSET = moderateScale(4);

export function BookMarker({
  coordinate,
  coverUrl,
  thumbnailUrl,
  title,
  onPress,
  variant = 'standard',
  selected = false,
  category = 'mint',
  stackCount = 0,
  distance,
}: BookMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const tracksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerUri = thumbnailUrl || coverUrl;

  useEffect(() => {
    setTracksViewChanges(true);
    if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    const timer = setTimeout(() => setTracksViewChanges(false), 2000);
    tracksTimerRef.current = timer;
    return () => {
      if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    };
  }, [markerUri]);

  const scale = selected ? 1.3 : 1;
  const isFresh = variant === 'fresh';
  const isShelf = variant === 'shelf';
  const isUnavailable = variant === 'unavailable';

  const ringColor = isUnavailable
    ? '#666666'
    : isFresh
      ? pastels.light.coral.ink
      : pastels.light[category].ink;

  const calloutTitle = isFresh ? `Yeni · ${title}` : title;

  const markerIcon = markerUri && !isShelf
    ? { uri: markerUri, width: MARKER_WIDTH, height: MARKER_HEIGHT }
    : undefined;

  const onLoadEnd = () => setTracksViewChanges(false);

  const coverImage = markerUri ? (
    <Image
      source={{ uri: markerUri }}
      style={[styles.cover, isUnavailable && styles.unavailableCover]}
      resizeMode="cover"
      onLoad={onLoadEnd}
      onError={onLoadEnd}
    />
  ) : (
    <View style={[styles.cover, styles.placeholder]} onLayout={onLoadEnd} />
  );

  const showChildren = Platform.OS === 'ios' || !markerIcon;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      {...(Platform.OS === 'android' && markerIcon ? { icon: markerIcon } : {})}
    >
      {showChildren && (
        <View style={[styles.wrapper, { transform: [{ scale }] }]}>
          {isShelf ? (
            <View style={styles.shelfStack}>
              <View style={styles.shelfBack}>
                {markerUri && (
                  <Image
                    source={{ uri: markerUri }}
                    style={styles.shelfBackImage}
                    resizeMode="cover"
                  />
                )}
              </View>
              <View style={[styles.box, { borderColor: ringColor, borderWidth: RING_WIDTH }]}>
                {coverImage}
              </View>
              {stackCount > 0 && (
                <View style={styles.stackBadge}>
                  <Text style={styles.stackBadgeText}>+{stackCount}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.box, { borderColor: ringColor, borderWidth: RING_WIDTH }]}>
              {coverImage}
            </View>
          )}
        </View>
      )}

      <Callout tooltip onPress={onPress}>
        <View style={styles.calloutContainer}>
          <View style={styles.calloutBubble}>
            <Text style={styles.calloutText} numberOfLines={1} ellipsizeMode="tail">
              {calloutTitle}
            </Text>
            {distance && variant !== 'standard' && (
              <Text style={styles.calloutDistance}>{distance}</Text>
            )}
          </View>
          <View style={styles.calloutArrow} />
        </View>
      </Callout>
    </Marker>
  );
}

const styles = StyleSheet.create({
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
  unavailableCover: {
    opacity: 0.35,
  },
  shelfStack: {
    width: MARKER_WIDTH + SHELF_OFFSET,
    height: MARKER_HEIGHT + SHELF_OFFSET,
  },
  shelfBack: {
    position: 'absolute',
    top: SHELF_OFFSET,
    left: SHELF_OFFSET,
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT,
    borderRadius: moderateScale(16),
    overflow: 'hidden',
    backgroundColor: '#FFF',
    borderWidth: moderateScale(1),
    borderColor: '#DDD',
  },
  shelfBackImage: {
    width: '100%',
    height: '100%',
    borderRadius: moderateScale(13),
  },
  stackBadge: {
    position: 'absolute',
    top: -moderateScale(4),
    right: -moderateScale(4),
    backgroundColor: '#F2766B',
    borderRadius: moderateScale(10),
    minWidth: moderateScale(20),
    height: moderateScale(20),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(4),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  stackBadgeText: {
    color: '#FFF',
    fontSize: moderateScale(11),
    fontWeight: '800',
  },
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
  calloutDistance: {
    color: '#8A8378',
    fontSize: moderateScale(11),
    textAlign: 'center',
    marginTop: moderateScale(2),
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
