import React from 'react';
import {
  View,
  Text,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from './tokens';
import { Button } from './button';

export interface EmptyStateProps {
  /**
   * Main message to display (e.g., 'No books found')
   */
  message: string;

  /**
   * Optional secondary text providing context (e.g., 'Try adjusting your filters')
   */
  description?: string;

  /**
   * Optional text for the action button
   */
  actionLabel?: string;

  /**
   * Callback when action button is pressed
   */
  onAction?: () => void;

  /**
   * Optional custom illustration component (overrides default)
   */
  illustration?: React.ReactNode;

  /**
   * Ionicon name shown inside the default pastel illustration circle.
   */
  icon?: React.ComponentProps<typeof Ionicons>['name'];

  /**
   * Optional style for the container
   */
  style?: ViewStyle;
}

/**
 * EmptyState component — displays an illustrated placeholder when content is absent.
 *
 * Features:
 * - Customizable illustration (or default visual)
 * - Primary message with optional description
 * - Optional action button for next steps
 * - Consistent spacing and typography from design tokens
 * - Centered layout with proper vertical rhythm
 *
 * Usage:
 * ```tsx
 * <EmptyState
 *   message="No books found"
 *   description="Try adjusting your search filters"
 *   actionLabel="Clear filters"
 *   onAction={() => clearFilters()}
 * />
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  description,
  actionLabel,
  onAction,
  illustration,
  icon = 'sparkles',
  style,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl }, style]} testID="empty-state">
      {illustration || (
        <View
          testID="default-illustration"
          style={{ width: 116, height: 116, borderRadius: radius.tile + 14, backgroundColor: colors.primarySoft, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xl }}
        >
          <Ionicons name={icon} size={48} color={colors.primary} />
        </View>
      )}
      <Text style={{ fontSize: fontSize.title, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.sm }} testID="empty-state-message">
        {message}
      </Text>
      {description ? (
        <Text style={{ fontSize: fontSize.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl, lineHeight: 22 }} testID="empty-state-description">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          variant="secondary"
          onPress={onAction}
          style={{ minWidth: 150 }}
          testID="empty-state-action"
        >
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
};
