import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, shadows } from '@/components/ui/tokens';

export function RightControls({ onRecenter, onFitAll, onCycleMapType, onFilter, insets, colors }: any) {
  return (
    <View style={[styles.container, { bottom: insets.bottom + 150 + spacing.md }]}>
      <TouchableOpacity style={styles.btn} onPress={onRecenter}>
        <Ionicons name="locate" size={22} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={onFilter}>
        <Ionicons name="options" size={22} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={onFitAll}>
        <Ionicons name="crop" size={22} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={onCycleMapType}>
        <Ionicons name="layers" size={22} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { position: 'absolute', right: spacing.lg, gap: spacing.sm, zIndex: 20 },
  btn: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', ...shadows.float },
});
