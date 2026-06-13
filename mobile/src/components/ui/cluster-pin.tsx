import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface ClusterPinProps {
  count: number;
}

export function ClusterPin({ count }: ClusterPinProps) {
  const size = Math.min(40 + count * 2, 60);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 999,
    backgroundColor: '#0F6E5D',
    borderWidth: 3,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  count: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
  },
});
