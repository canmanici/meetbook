import React from 'react';
import { Circle } from 'react-native-maps';

export function RadiusCircle({ center, radiusKm, color }: { center: { lat: number; lng: number }; radiusKm: number; color: string }) {
  return (
    <Circle
      center={{ latitude: center.lat, longitude: center.lng }}
      radius={radiusKm * 1000}
      strokeColor={`${color}66`}
      strokeWidth={2}
      fillColor={`${color}0D`}
    />
  );
}
