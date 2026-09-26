import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize, shadows } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = () => {
    if (!disabled && !loading && onPress) {
      onPress();
    }
  };

  const variantStyles: Record<ButtonVariant, { bg: string; text: string }> = {
    primary: { bg: colors.primary, text: '#FFFFFF' },
    secondary: { bg: colors.primarySoft, text: colors.primary },
    ghost: { bg: 'transparent', text: colors.primary },
    danger: { bg: colors.danger, text: '#FFFFFF' },
  };
  const v = variantStyles[variant];
  const elevated = variant === 'primary' || variant === 'danger';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: v.bg },
        elevated && !disabled && !loading && shadows.float,
        elevated && !disabled && !loading && { shadowColor: v.bg },
        (disabled || loading) && styles.disabled,
        isPressed && styles.pressed,
        style,
      ]}
      onPress={handlePress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      disabled={disabled || loading}
      activeOpacity={1.0}
      testID={testID ?? (loading ? "button-loading" : "button")}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <Text style={[styles.text, { color: v.text }]}>{children}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.92,
  },
  text: {
    fontSize: fontSize.body,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
