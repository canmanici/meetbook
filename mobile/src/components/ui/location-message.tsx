import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, shadows } from './tokens';
import type { MessageView } from '@/lib/api/chat';

interface LocationMessageProps {
  message: MessageView;
  isMine: boolean;
}

export const LocationMessage: React.FC<LocationMessageProps> = ({ message, isMine }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const lat = message.extra?.lat;
  const lng = message.extra?.lng;
  const name = message.extra?.name || 'Konum';

  const openInMaps = () => {
    if (lat && lng) {
      const url = `https://www.google.com/maps?q=${lat},${lng}`;
      Linking.openURL(url);
    }
  };

  return (
    <TouchableOpacity
      onPress={openInMaps}
      activeOpacity={0.8}
      style={[
        styles.container,
        {
          backgroundColor: isMine ? colors.primary + '15' : colors.surfaceAlt,
          borderColor: colors.border,
        },
        shadows.card,
      ]}
    >
      {/* Map placeholder */}
      <View style={[styles.mapPlaceholder, { backgroundColor: colors.primary + '10' }]}>
        <Ionicons name="map" size={32} color={colors.primary} />
        <View style={[styles.pin, { backgroundColor: colors.primary }]}>
          <Ionicons name="location" size={14} color="#ffffff" />
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        {lat && lng && (
          <Text style={[styles.coords, { color: colors.textMuted }]}>
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </Text>
        )}
      </View>

      <Ionicons name="open-outline" size={16} color={colors.textMuted} style={{ marginLeft: spacing.xs }} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    maxWidth: 260,
  },
  mapPlaceholder: {
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pin: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    padding: spacing.sm,
    gap: 2,
  },
  name: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  coords: {
    fontSize: fontSize.caption,
  },
});
