/**
 * MapLibre adapter — provides react-native-maps-like API on top of
 * @maplibre/maplibre-react-native so existing components need minimal changes.
 *
 * Exports: MapView, Marker, Circle, GeoJSONSource, Layer, Camera
 * Types: Region, LatLng, MapPressEvent
 *
 * SAFETY: If MapLibre's native module isn't available (e.g. Expo Go),
 * fallback components are exported so the app doesn't crash.
 */
import React, { forwardRef, useCallback, useRef, useImperativeHandle, useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import type { Feature, GeoJsonProperties } from 'geojson';

// ── Map style ──────────────────────────────────────────────────────────────
// MapTiler Streets v2 — beautiful worldwide OSM map with labels and fonts.
// Free tier: 100K requests/month.
const MAPTILER_KEY = 'eKJft93A5dolP425TPfm';
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

// ── Safe MapLibre import ────────────────────────────────────────────────────
// Use dynamic require so the app doesn't crash if the native module is missing.
let ML: any = null;
let MAPLIBRE_AVAILABLE = false;

try {
  ML = require('@maplibre/maplibre-react-native');
  MAPLIBRE_AVAILABLE = true;
} catch {
  MAPLIBRE_AVAILABLE = false;
}

// ── Re-export MapLibre primitives (with fallbacks) ──────────────────────────
export const GeoJSONSource: any = MAPLIBRE_AVAILABLE ? ML.GeoJSONSource : View;
export const Layer: any = MAPLIBRE_AVAILABLE ? ML.Layer : View;
export const Camera: any = MAPLIBRE_AVAILABLE ? ML.Camera : View;
export type GeoJSONSourceProps = any;
export type LayerProps = any;

// ── Direct MapLibre access (for advanced usage in home.tsx) ────────────────
export { MAPLIBRE_AVAILABLE };
export { MAP_STYLE };
export const MLMap: any = MAPLIBRE_AVAILABLE ? ML.Map : null;
export const MLMarker: any = MAPLIBRE_AVAILABLE ? ML.Marker : null;
export const MLGeoJSONSource: any = MAPLIBRE_AVAILABLE ? ML.GeoJSONSource : null;
export const MLLayer: any = MAPLIBRE_AVAILABLE ? ML.Layer : null;

// ── Types matching react-native-maps ───────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapPressEvent {
  nativeEvent: {
    coordinate: LatLng;
  };
}

export interface MapViewRef {
  animateToRegion: (region: Region, duration?: number) => void;
  getCenter: () => Promise<LatLng>;
}

// ── Coordinate helpers ─────────────────────────────────────────────────────

function regionToCenter(region: Region): [number, number] {
  return [region.longitude, region.latitude];
}

function deltaToZoom(delta: number): number {
  return Math.max(0, Math.min(20, Math.log2(360 / delta)));
}

// ── Fallback MapView (shown when MapLibre is unavailable) ──────────────────

const FallbackMapView = forwardRef<any, any>((props, ref) => {
  React.useImperativeHandle(ref, () => ({}));
  return (
    <View style={[styles.map, props.style, styles.fallbackContainer]}>
      <Text style={styles.fallbackText}>
        Harita Development Build{'\n'}gerekli. Expo Go'da calismaz.
      </Text>
    </View>
  );
});
FallbackMapView.displayName = 'FallbackMapView';

// ── Internal MapView implementation ────────────────────────────────────────

const RealMapView = forwardRef<any, any>(
  (
    {
      style,
      children,
      region,
      initialRegion,
      onPress,
      onRegionDidChange,
      testID,
    },
    ref,
  ) => {
    const mapRef = useRef<any>(null);
    const cameraRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      ...mapRef.current!,
    }));

    const center: [number, number] = initialRegion
      ? regionToCenter(initialRegion)
      : region
        ? regionToCenter(region)
        : [28.9784, 41.0082];

    const zoom = initialRegion
      ? deltaToZoom(initialRegion.latitudeDelta)
      : region
        ? deltaToZoom(region.latitudeDelta)
        : 12;

    const MapComponent = ML.Map;
    const CameraComponent = ML.Camera;

    return (
      <MapComponent
        ref={mapRef}
        style={[styles.map, style]}
        testID={testID}
        logo={false}
        attribution={false}
        onDidFinishLoadingMap={() => {}}
        onRegionDidChange={onRegionDidChange}
        mapStyle={MAP_STYLE}
      >
        <CameraComponent
          ref={cameraRef}
          initialViewState={{
            center: center,
            zoom,
          }}
        />
        {children}
      </MapComponent>
    );
  },
);
RealMapView.displayName = 'MapView';

// ── MapView (conditionally real or fallback) ───────────────────────────────

export const MapView: any = MAPLIBRE_AVAILABLE ? RealMapView : FallbackMapView;

// ── Marker ─────────────────────────────────────────────────────────────────

export interface MarkerProps {
  coordinate: LatLng;
  anchor?: { x: number; y: number };
  tracksViewChanges?: boolean;
  onPress?: () => void;
  pinColor?: string;
  children?: React.ReactNode;
  testID?: string;
}

export function Marker({
  coordinate,
  anchor,
  tracksViewChanges,
  onPress,
  pinColor,
  children,
  testID,
}: MarkerProps) {
  if (!MAPLIBRE_AVAILABLE) return null;

  const lngLat: [number, number] = [coordinate.longitude, coordinate.latitude];
  const MLMarkerComponent = ML.Marker;

  return (
    <MLMarkerComponent
      lngLat={lngLat}
      anchor={anchor as any}
      testID={testID}
      onPress={onPress as any}
    >
      {(children ??
        <View
          style={[
            styles.pin,
            pinColor ? { backgroundColor: pinColor } : styles.pinDefault,
          ]}
        />) as any}
    </MLMarkerComponent>
  );
}

// ── Circle ─────────────────────────────────────────────────────────────────

export interface CircleProps {
  center: LatLng;
  radius: number; // meters
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  lineDashPattern?: number[];
  testID?: string;
}

export function Circle({
  center,
  radius,
  strokeColor = '#000000',
  strokeWidth = 1,
  fillColor = 'transparent',
  lineDashPattern,
  testID,
}: CircleProps) {
  if (!MAPLIBRE_AVAILABLE) return null;

  const sourceId = `circle-${center.latitude}-${center.longitude}-${radius}`;
  const features = createCircleGeoJSON(center, radius, 64);
  const GeoJSONSourceComponent = ML.GeoJSONSource;
  const LayerComponent = ML.Layer;

  return (
    <GeoJSONSourceComponent key={sourceId} id={sourceId} data={features} testID={testID}>
      <LayerComponent
        key={`${sourceId}-fill`}
        id={`${sourceId}-fill`}
        type="fill"
        paint={{
          'fill-color': fillColor,
          'fill-opacity': 1,
        }}
      />
      <LayerComponent
        key={`${sourceId}-stroke`}
        id={`${sourceId}-stroke`}
        type="line"
        paint={{
          'line-color': strokeColor,
          'line-width': strokeWidth,
          ...(lineDashPattern ? { 'line-dasharray': lineDashPattern } : {}),
        }}
      />
    </GeoJSONSourceComponent>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a GeoJSON polygon approximating a circle */
function createCircleGeoJSON(
  center: LatLng,
  radiusMeters: number,
  segments: number,
): Feature {
  const coords: [number, number][] = [];
  const earthRadius = 6371000;
  const latRad = (center.latitude * Math.PI) / 180;
  const degLatPerMeter = 1 / earthRadius;
  const degLngPerMeter = 1 / (earthRadius * Math.cos(latRad));

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const dLat = radiusMeters * Math.cos(angle) * degLatPerMeter;
    const dLng = radiusMeters * Math.sin(angle) * degLngPerMeter;
    coords.push([
      center.longitude + (dLng * 180) / Math.PI,
      center.latitude + (dLat * 180) / Math.PI,
    ]);
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
    properties: {},
  };
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  fallbackText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  pin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  pinDefault: {
    backgroundColor: '#E53935',
  },
});
