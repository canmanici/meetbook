import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

interface MapBookPinProps {
  coverUrl?: string;
  title: string;
  isSelected?: boolean;
}

export function MapBookPin({ coverUrl, title, isSelected = false }: MapBookPinProps) {
  return (
    <View style={[styles.container, isSelected && styles.selected]}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.placeholder]}>
          <View style={styles.placeholderLines}>
            <View style={styles.line} />
            <View style={[styles.line, { width: '60%' }]} />
          </View>
        </View>
      )}
      <View style={styles.pointer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  selected: {
    transform: [{ scale: 1.1 }],
  },
  cover: {
    width: 48,
    height: 64,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  placeholder: {
    backgroundColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderLines: {
    gap: 4,
    alignItems: 'center',
  },
  line: {
    height: 3,
    width: '70%',
    backgroundColor: '#bbb',
    borderRadius: 2,
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
    marginTop: -2,
  },
});
