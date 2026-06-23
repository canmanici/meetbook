import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { MapView, Marker, type LatLng, type MapPressEvent, type MapViewRef } from '@/lib/map-adapter';

import { Button, InlineError, palette, spacing } from '@/components/ui';
import { useBookDraftStore } from '@/stores/book-draft-store';

const ISTANBUL_REGION = {
  latitude: 41.0082,
  longitude: 28.9784,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

export default function LocationPickerScreen() {
  const setPickedLocation = useBookDraftStore((state) => state.setPickedLocation);

  const [marker, setMarker] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const mapRef = useRef<any>(null);

  const onMapPress = (event: MapPressEvent) => {
    setMarker(event.nativeEvent.coordinate);
  };

  const useMyLocation = async () => {
    setError(null);
    setLocationLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setError('Konum izni verilmedi.');
      setLocationLoading(false);
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      setMarker({ latitude, longitude });
      // MapLibre doesn't support animateToRegion on MapView ref directly
      // The map will center on the marker via the region prop
    } catch {
      setError('Konum alınamadı.');
    } finally {
      setLocationLoading(false);
    }
  };

  const onConfirm = () => {
    if (!marker) {
      return;
    }
    setPickedLocation({ lat: marker.latitude, lng: marker.longitude });
    router.back();
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={ISTANBUL_REGION}
        onPress={onMapPress}
        testID="location-picker-map">
        {marker && <Marker coordinate={marker} testID="location-picker-marker" />}
      </MapView>
      <View style={styles.controls}>
        {locationLoading && (
          <View style={styles.locationLoadingCard}>
            <ActivityIndicator size="small" color={palette.light.primary} />
            <Text style={styles.locationLoadingText}>Konum yükleniyor...</Text>
          </View>
        )}
        {!locationLoading && error && <InlineError message={error} />}
        <Button variant="secondary" onPress={useMyLocation} disabled={locationLoading} testID="use-my-location-button">
          Konumumu kullan
        </Button>
        <Button onPress={onConfirm} disabled={!marker} testID="confirm-location-button">
          Bu konumu kaydet
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  controls: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  locationLoadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: palette.light.surface,
    borderRadius: 8,
  },
  locationLoadingText: {
    fontSize: 13,
    color: palette.light.textMuted,
  },
});
