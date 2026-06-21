/**
 * RadiusCircle — spec §3.8 radius filter visualization.
 *
 * Renders:
 * 1. A dashed Circle overlay (palette.primary 40% alpha stroke, 5% alpha fill)
 * 2. A tappable label chip ("{radiusKm} km") at the north edge of the circle
 *    → opens QuickRadiusSheet for quick adjustment
 *
 * Uses Marker.onPress (not child TouchableOpacity) because Android doesn't
 * reliably fire touch events on Marker children.
 */
import React from 'react';
import { Circle, Marker } from 'react-native-maps';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { fontSize } from '@/components/ui/tokens';

interface RadiusCircleProps {
  center: { lat: number; lng: number };
  radiusKm: number;
  color: string;
  onLabelPress?: () => void;
  testID?: string;
}

// ~111 km per degree of latitude
const KM_PER_DEG_LAT = 111;

export function RadiusCircle({
  center,
  radiusKm,
  color,
  onLabelPress,
  testID,
}: RadiusCircleProps) {
  const radiusM = radiusKm * 1000;
  // North edge of the circle for the label chip
  const labelLat = center.lat + radiusKm / KM_PER_DEG_LAT;

  return (
    <>
      <Circle
        center={{ latitude: center.lat, longitude: center.lng }}
        radius={radiusM}
        strokeColor={`${color}66`}
        strokeWidth={2}
        lineDashPattern={[8, 6]}
        fillColor={`${color}0D`}
        testID={`${testID}-circle`}
      />
      <Marker
        coordinate={{ latitude: labelLat, longitude: center.lng }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        onPress={onLabelPress}
        testID={`${testID}-label`}
      >
        <View style={[styles.label, { backgroundColor: color }]}>
          <Text style={styles.labelText}>{radiusKm} km</Text>
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
      android: { elevation: 4 },
    }),
  },
  labelText: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
});

export default RadiusCircle;
