import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type LatLng, type MapPressEvent } from 'react-native-maps';

import { Button, InlineError, spacing } from '@/components/ui';
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

  const onMapPress = (event: MapPressEvent) => {
    setMarker(event.nativeEvent.coordinate);
  };

  const useMyLocation = async () => {
    setError(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setError('Konum izni verilmedi.');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({});
      setMarker({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      setError('Konum alınamadı.');
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
        style={styles.map}
        initialRegion={ISTANBUL_REGION}
        onPress={onMapPress}
        testID="location-picker-map">
        {marker && <Marker coordinate={marker} testID="location-picker-marker" />}
      </MapView>
      <View style={styles.controls}>
        {error && <InlineError message={error} />}
        <Button variant="secondary" onPress={useMyLocation} testID="use-my-location-button">
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
});
