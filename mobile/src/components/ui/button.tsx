import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
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
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = () => {
    if (!disabled && !loading && onPress) {
      onPress();
    }
  };

  const buttonStyle = [
    styles.button,
    styles[variant],
    (disabled || loading) && styles.disabled,
    isPressed && styles.pressed,
    style,
  ];

  const textStyle = [
    styles.text,
    styles[`${variant}Text`],
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={handlePress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      disabled={disabled || loading}
      activeOpacity={1.0}
      testID={testID ?? (loading ? "button-loading" : "button")}
    >
      {loading ? (
        <ActivityIndicator color={palette.light.surface} size="small" />
      ) : (
        <Text style={textStyle}>{children}</Text>
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
  primary: {
    backgroundColor: palette.light.primary,
  },
  primaryText: {
    color: palette.light.surface,
  },
  secondary: {
    backgroundColor: palette.light.surface,
    borderWidth: 1,
    borderColor: palette.light.primary,
  },
  secondaryText: {
    color: palette.light.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: palette.light.primary,
  },
  danger: {
    backgroundColor: palette.light.danger,
  },
  dangerText: {
    color: palette.light.surface,
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
