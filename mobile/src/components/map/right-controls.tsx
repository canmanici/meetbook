import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { spacing, radius } from '@/components/ui/tokens';

export function RightControls({ onRecenter, onFitAll, onCycleMapType, onFilter, filterCount, insets, colors, isDark }: any) {
  const tint = isDark ? 'dark' : 'light';
  return (
    <View style={[styles.container, { bottom: insets.bottom + 180 + spacing.md }]}>
      <TouchableOpacity onPress={onRecenter}>
        <BlurView tint={tint} intensity={40} style={[styles.btn, styles.accentBtn]}>
          <Ionicons name="locate" size={22} color={colors.primary} />
        </BlurView>
      </TouchableOpacity>
      <TouchableOpacity onPress={onFilter}>
        <BlurView tint={tint} intensity={40} style={styles.btn}>
          <Ionicons name="options" size={22} color={colors.primary} />
          {filterCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{filterCount}</Text></View>}
        </BlurView>
      </TouchableOpacity>
      <TouchableOpacity onPress={onFitAll}>
        <BlurView tint={tint} intensity={40} style={styles.btn}>
          <Ionicons name="crop" size={22} color={colors.primary} />
        </BlurView>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCycleMapType}>
        <BlurView tint={tint} intensity={40} style={styles.btn}>
          <Ionicons name="layers" size={22} color={colors.primary} />
        </BlurView>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', right: spacing.lg, gap: spacing.sm, zIndex: 20 },
  btn: {
    width: 44, height: 44, borderRadius: radius.field,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  accentBtn: { backgroundColor: 'rgba(17,128,107,0.9)' },
  badge: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#F2766B',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
