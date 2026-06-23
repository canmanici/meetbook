/**
 * UserLocationDot — spec §3.4 user dot with accuracy ring + pulse.
 *
 * Renders:
 * 1. Accuracy ring — semi-transparent Circle overlay (~100m radius, themed)
 * 2. Pulse — expanding Circle (2.5s loop, 20m → 200m, fading opacity)
 * 3. Core dot — Marker with 18px colored view + white border
 *
 * The pulse uses a JS animation loop (setInterval) because Marker children
 * don't animate on Android (rendered to bitmap). Circle overlays animate
 * reliably via prop updates on both platforms.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Circle, Marker } from '@/lib/map-adapter';
import { View, StyleSheet } from 'react-native';
import { moderateScale } from 'react-native-size-matters';

interface UserLocationDotProps {
  coordinate: { lat: number; lng: number };
  color: string;
  accuracyM?: number;
  testID?: string;
}

const PULSE_DURATION_MS = 2500;
const PULSE_INTERVAL_MS = 50;
const PULSE_MIN_M = 20;
const PULSE_MAX_M = 200;

export function UserLocationDot({
  coordinate,
  color,
  accuracyM = 100,
  testID,
}: UserLocationDotProps) {
  const [pulse, setPulse] = useState({ radius: PULSE_MIN_M, opacity: 0.6 });
  const frameRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = Date.now();
    frameRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) % PULSE_DURATION_MS;
      const progress = elapsed / PULSE_DURATION_MS;
      setPulse({
        radius: PULSE_MIN_M + (PULSE_MAX_M - PULSE_MIN_M) * progress,
        opacity: 0.6 * (1 - progress),
      });
    }, PULSE_INTERVAL_MS);

    return () => {
      if (frameRef.current) clearInterval(frameRef.current);
    };
  }, []);

  const { latitude, longitude } = { latitude: coordinate.lat, longitude: coordinate.lng };

  return (
    <>
      {/* Accuracy ring */}
      <Circle
        center={{ latitude, longitude }}
        radius={accuracyM}
        strokeColor={`${color}30`}
        strokeWidth={1}
        fillColor={`${color}14`}
        testID={`${testID}-accuracy`}
      />

      {/* Pulse ring (animated) */}
      <Circle
        center={{ latitude, longitude }}
        radius={pulse.radius}
        strokeColor={`${color}40`}
        strokeWidth={2}
        fillColor={`${color}${Math.round(pulse.opacity * 255).toString(16).padStart(2, '0')}`}
        testID={`${testID}-pulse`}
      />

      {/* Core dot */}
      <Marker
        coordinate={{ latitude, longitude }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        testID={`${testID}-dot`}
      >
        <View style={[styles.dot, { backgroundColor: color }]}>
          <View style={styles.dotInner} />
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: moderateScale(18),
    height: moderateScale(18),
    borderRadius: moderateScale(9),
    borderWidth: 3,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  dotInner: {
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
    backgroundColor: '#FFFFFF',
  },
});

export default UserLocationDot;
