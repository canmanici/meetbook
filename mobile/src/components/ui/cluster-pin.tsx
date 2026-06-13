import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { palette } from './tokens';

interface ClusterPinProps {
  count: number;
}

export function ClusterPin({ count }: ClusterPinProps) {
  const size = Math.min(40 + count * 2, 60);
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.container, { width: size, height: size, backgroundColor: colors.primary, borderColor: colors.surface }]}>
      <Text style={[styles.count, { color: colors.surface }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 999,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  count: {
    fontWeight: '800',
    fontSize: 16,
  },
});
