import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from './tokens';

interface SuggestedPlaceProps {
  name: string;
  category: string;
  address?: string;
  distanceKm?: number;
  rating?: number;
  onSelect: () => void;
}

export function SuggestedPlace({ name, category, address, distanceKm, rating, onSelect }: SuggestedPlaceProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.textMuted + '30' }]}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
          <Ionicons name="location" size={18} color={colors.primary} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.category, { color: colors.textMuted }]}>{category}</Text>
        </View>
      </View>
      {address && (
        <Text style={[styles.address, { color: colors.textMuted }]} numberOfLines={1}>{address}</Text>
      )}
      <View style={styles.footer}>
        {distanceKm != null && (
          <View style={[styles.badge, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="navigate" size={12} color={colors.primary} />
            <Text style={[styles.badgeText, { color: colors.primary }]}>{distanceKm.toFixed(1)} km</Text>
          </View>
        )}
        {rating != null && (
          <View style={[styles.badge, { backgroundColor: colors.accent + '15' }]}>
            <Ionicons name="star" size={12} color={colors.accent} />
            <Text style={[styles.badgeText, { color: colors.accent }]}>{rating.toFixed(1)}</Text>
          </View>
        )}
        <TouchableOpacity style={[styles.selectBtn, { backgroundColor: colors.primary }]} onPress={onSelect}>
          <Text style={styles.selectBtnText}>Seç</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  category: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  address: {
    fontSize: fontSize.bodySm,
    marginLeft: 48,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 48,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  selectBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.input,
  },
  selectBtnText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});