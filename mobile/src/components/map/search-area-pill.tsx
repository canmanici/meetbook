import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, fontSize } from '@/components/ui/tokens';

export function SearchAreaPill({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.pill} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="add-circle-outline" size={16} color="#fff" />
      <Text style={styles.text}>Bu alanı ara</Text>
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  pill: {
    position: 'absolute', bottom: 200, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: '#2A2722', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: 20, zIndex: 20,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }, android: { elevation: 8 } }),
  },
  text: { color: '#fff', fontSize: fontSize.bodySm, fontWeight: '700' },
});
