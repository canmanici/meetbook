import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

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
    primary: { bg: colors.primary, text: colors.surface },
    secondary: { bg: colors.surface, text: colors.primary },
    ghost: { bg: 'transparent', text: colors.primary },
    danger: { bg: colors.danger, text: colors.surface },
  };
  const v = variantStyles[variant];

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: v.bg },
        variant === 'secondary' && { borderColor: colors.primary, borderWidth: 1 },
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
        <ActivityIndicator color={colors.surface} size="small" />
      ) : (
        <Text style={[styles.text, { color: v.text }]}>{children}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: radius.input,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  text: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
