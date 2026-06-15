import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  useColorScheme,
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
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const tint = colors[variant];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tint + '22' },
        style,
      ]}
      testID={testID}
    >
      <Text style={[styles.text, { color: tint }]}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
