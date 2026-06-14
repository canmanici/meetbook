import React from 'react';
import { View, Image, StyleSheet, Text } from 'react-native';

interface MapBookPinProps {
  coverUrl?: string;
  title: string;
  isSelected?: boolean;
}

export function MapBookPin({ coverUrl, title, isSelected = false }: MapBookPinProps) {
  return (
    <View style={[styles.markerWrapper, isSelected && styles.selected]}>
      <View style={styles.titleContainer}>
        <Text style={styles.titleText} numberOfLines={1} ellipsizeMode="tail">
          {title || ''}
        </Text>
      </View>
      <View style={styles.shadowContainer}>
        {coverUrl ? (
          <Image 
            source={{ uri: coverUrl }} 
            style={styles.coverImage} 
            resizeMode="cover" 
          />
        ) : (
          <View style={[styles.coverImage, styles.placeholder]} />
        )}
      </View>
      <View style={styles.pointer} />
    </View>
  );
}

const styles = StyleSheet.create({
  markerWrapper: {
    alignItems: 'center',
  },
  selected: {
    transform: [{ scale: 1.2 }],
    zIndex: 10,
  },
  titleContainer: {
    backgroundColor: '#FFF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCC',
    marginBottom: 4,
    maxWidth: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  titleText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  shadowContainer: {
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    borderRadius: 6,
  },
  coverImage: {
    width: 40,
    height: 40,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#FFF',
    backgroundColor: '#000',
  },
  placeholder: {
    backgroundColor: '#333',
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFF',
  },
});