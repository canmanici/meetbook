import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  visible: boolean;
  variant?: ToastVariant;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Toast notification component for displaying temporary messages.
 *
 * Variants:
 * - success: Green background for successful operations
 * - error: Red background for errors and failures
 * - info: Blue background for informational messages (default)
 *
 * @example
 * ```tsx
 * <Toast message="Login successful!" visible variant="success" />
 * <Toast message="Connection failed" visible variant="error" />
 * ```
 */
export const Toast: React.FC<ToastProps> = ({
  message,
  visible,
  variant = 'info',
  style,
  testID = 'toast',
}) => {
  if (!visible) return null;

  const variantColors: Record<ToastVariant, string> = {
    success: palette.light.success,
    error: palette.light.danger,
    info: palette.light.info,
  };

  return (
    <View
      style={[
        styles.toast,
        { backgroundColor: variantColors[variant] },
        style,
      ]}
      testID={testID}
    >
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

interface InlineErrorProps {
  message: string;
  style?: ViewStyle;
  testID?: string;
}

/**
 * InlineError component for displaying human-friendly error messages within content.
 *
 * Unlike Toast which floats above content, InlineError is part of the document flow
 * and is useful for showing persistent error states or feedback after failed operations.
 *
 * @example
 * ```tsx
 * <InlineError message="Couldn't reach the server — pull to retry" />
 * <InlineError message="No books found in your area" />
 * ```
 */
export const InlineError: React.FC<InlineErrorProps> = ({
  message,
  style,
  testID = 'inline-error',
}) => {
  return (
    <View style={[styles.inlineError, style]} testID={testID}>
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorMessage}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    padding: spacing.md,
    borderRadius: radius.input,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 1000,
  },
  message: {
    fontSize: fontSize.body,
    color: palette.light.surface,
    textAlign: 'center',
    fontWeight: '500',
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${palette.light.danger}10`,
    padding: spacing.md,
    borderRadius: radius.input,
    borderLeftWidth: 4,
    borderLeftColor: palette.light.danger,
  },
  errorIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  errorMessage: {
    flex: 1,
    fontSize: fontSize.bodySm,
    color: palette.light.danger,
    lineHeight: 20,
  },
});
