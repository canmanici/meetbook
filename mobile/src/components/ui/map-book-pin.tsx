import React from 'react';
import { View, Image, StyleSheet, useColorScheme } from 'react-native';
import { palette } from './tokens';

interface MapBookPinProps {
  coverUrl?: string;
  title: string;
  isSelected?: boolean;
}

export function MapBookPin({ coverUrl, title, isSelected = false }: MapBookPinProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.container, isSelected && styles.selected]}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={[styles.cover, { borderColor: colors.surface }]} />
      ) : (
        <View style={[styles.cover, styles.placeholder, { backgroundColor: colors.textMuted + '40' }]}>
          <View style={styles.placeholderLines}>
            <View style={[styles.line, { backgroundColor: colors.textMuted + '60' }]} />
            <View style={[styles.line, { width: '60%', backgroundColor: colors.textMuted + '60' }]} />
          </View>
        </View>
      )}
      <View style={[styles.pointer, { borderTopColor: colors.surface }]} />
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  placeholder: {
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
    marginTop: -2,
  },
});
