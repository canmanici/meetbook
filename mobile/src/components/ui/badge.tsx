import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'primary';

interface BadgeProps {
  text: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  testID?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  text,
  variant = 'primary',
  style,
  testID = 'badge',
}) => {
  const variantColors: Record<BadgeVariant, string> = {
    success: palette.light.success,
    warning: palette.light.warning,
    danger: palette.light.danger,
    info: palette.light.info,
    primary: palette.light.primary,
  };

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: variantColors[variant] },
        style,
      ]}
      testID={testID}
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: palette.light.surface,
  },
});
