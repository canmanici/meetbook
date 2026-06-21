import React from 'react';
import { Marker } from 'react-native-maps';
import { View, StyleSheet } from 'react-native';

export function UserLocationDot({ coordinate, color }: { coordinate: { lat: number; lng: number }; color: string }) {
  return (
    <Marker coordinate={{ latitude: coordinate.lat, longitude: coordinate.lng }} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={[styles.dot, { backgroundColor: color, borderColor: '#fff', borderWidth: 3 }]} />
    </Marker>
  );
}
const styles = StyleSheet.create({ dot: { width: 16, height: 16, borderRadius: 8 } });
