import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useColorScheme,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, spacing, radius, fontSize } from './tokens';

export type SkeletonVariant = 'card' | 'list-item';

export interface SkeletonProps {
  /**
   * Visual style variant
   * - 'card': Full card skeleton (for grid layouts)
   * - 'list-item': Horizontal list item skeleton (for list views)
   */
  variant?: SkeletonVariant;

  /**
   * Optional custom container style
   */
  style?: ViewStyle;
}

/** Duration of one left → right sweep of the shimmer band. */
const SHIMMER_DURATION_MS = 1200;

/** Idle time between two sweeps. */
const SHIMMER_PAUSE_MS = 250;

/** Gradient stops of the sweeping band — brighter on light surfaces. */
const SHIMMER_COLORS = {
  light: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'],
  dark: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0)'],
} as const;

/**
 * Subscribes to the OS "reduce motion" accessibility setting.
 *
 * Core-RN equivalent of Reanimated's `useReducedMotion()`: reads the current
 * value and listens for changes, so toggling the setting while the app is
 * open is picked up as well.
 */
function useReduceMotionPreference(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const update = (enabled: boolean) =>
      setReduceMotion((previous) => (previous === enabled ? previous : enabled));

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          update(enabled);
        }
      })
      .catch(() => {
        // Stay at null (sweep off) if the setting can't be read — the safe
        // default for motion-sensitive users.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

interface ShimmerBoxProps {
  testID: string;
  /**
   * Style for the placeholder box itself. Kept as a single flat object —
   * skeleton tests assert on `props.style.width/height/opacity` directly.
   */
  boxStyle: ViewStyle;
  /** Sweep driver shared by every box of one <Skeleton>. */
  progress: Animated.Value;
  /** Whether the sweep is allowed to run (false for reduced motion). */
  animate: boolean;
  /** Gradient stops of the sweeping band. */
  shimmerColors: readonly [string, string, string];
}

/**
 * One placeholder box: the muted base rectangle plus — once measured — a
 * translucent gradient band that is swept across it on the native thread.
 *
 * The band lives in a wrapper *around* the base box (not inside it) because
 * the base box carries `opacity: 0.15`, which would fade the sweep too.
 */
const ShimmerBox: React.FC<ShimmerBoxProps> = ({
  testID,
  boxStyle,
  progress,
  animate,
  shimmerColors,
}) => {
  const [width, setWidth] = useState(0);

  const wrapperStyle: ViewStyle = {
    width: boxStyle.width,
    height: boxStyle.height,
    marginTop: boxStyle.marginTop,
    marginRight: boxStyle.marginRight,
    marginBottom: boxStyle.marginBottom,
    marginLeft: boxStyle.marginLeft,
    borderRadius: boxStyle.borderRadius,
    overflow: 'hidden',
  };

  // Percentage widths are resolved against the wrapper's parent row, so the
  // base fills the wrapper instead of resolving the percentage twice.
  const baseStyle: ViewStyle =
    typeof boxStyle.width === 'string' ? { ...boxStyle, width: '100%' } : boxStyle;

  const bandWidth = Math.max(width * 0.5, 32);
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    // Enter from off the left edge, exit off the right edge.
    outputRange: [-bandWidth, width],
  });

  return (
    <View style={wrapperStyle} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View testID={testID} style={baseStyle} />
      {animate && width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.shimmerBand, { width: bandWidth, transform: [{ translateX }] }]}
        >
          <LinearGradient
            colors={shimmerColors}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  shimmerBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
});

/**
 * Skeleton component — loading placeholder for content before it loads.
 *
 * Features:
 * - Two variants: card (for grid layouts) and list-item (for list views)
 * - Moving shimmer: a translucent gradient band is swept left → right across
 *   every placeholder box. A single `Animated.Value` loop drives all boxes of
 *   one <Skeleton> and runs on the native thread (`useNativeDriver: true`).
 * - Respects the OS "reduce motion" setting: boxes stay static, no sweep.
 * - Matches real component dimensions and spacing
 * - Uses design tokens for consistency
 *
 * Usage:
 * ```tsx
 * // Card skeleton for book grid
 * <Skeleton variant="card" />
 *
 * // List item skeleton for search results
 * <Skeleton variant="list-item" />
 * ```
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'list-item',
  style,
}) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const reduceMotion = useReduceMotionPreference();
  // Start the sweep only once the preference has been read (null = unknown).
  const animate = reduceMotion === false;

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      return undefined;
    }

    progress.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: SHIMMER_DURATION_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(SHIMMER_PAUSE_MS),
      ]),
      { resetBeforeIteration: true },
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [animate, progress]);

  const baseTint = { backgroundColor: colors.textMuted, opacity: 0.15 } as const;
  const shimmerColors = isDark ? SHIMMER_COLORS.dark : SHIMMER_COLORS.light;

  const box = (testID: string, boxStyle: ViewStyle) => (
    <ShimmerBox
      testID={testID}
      boxStyle={boxStyle}
      progress={progress}
      animate={animate}
      shimmerColors={shimmerColors}
    />
  );

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderRadius: radius.input,
          padding: spacing.md,
          marginBottom: spacing.sm,
        },
        style,
      ]}
      testID={variant === 'card' ? 'skeleton-card' : 'skeleton-list'}
    >
      {variant === 'card' ? (
        <>
          {box('skeleton-cover', {
            width: 60,
            height: 80,
            borderRadius: radius.input,
            marginRight: spacing.md,
            ...baseTint,
          })}
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            {box('skeleton-title', {
              height: fontSize.body,
              borderRadius: radius.input,
              marginBottom: spacing.xs,
              width: '90%',
              ...baseTint,
            })}
            {box('skeleton-author', {
              height: fontSize.bodySm,
              borderRadius: radius.input,
              marginBottom: spacing.sm,
              width: '60%',
              ...baseTint,
            })}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {box('skeleton-badge', {
                height: 20,
                borderRadius: radius.pill,
                width: 60,
                ...baseTint,
              })}
              {box('skeleton-distance', {
                height: fontSize.bodySm,
                borderRadius: radius.input,
                width: 40,
                ...baseTint,
              })}
            </View>
          </View>
        </>
      ) : (
        <>
          {box('skeleton-cover', {
            width: 50,
            height: 70,
            borderRadius: radius.input,
            marginRight: spacing.md,
            ...baseTint,
          })}
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            {box('skeleton-title', {
              height: fontSize.body,
              borderRadius: radius.input,
              marginBottom: spacing.xs,
              width: '80%',
              ...baseTint,
            })}
            {box('skeleton-author', {
              height: fontSize.bodySm,
              borderRadius: radius.input,
              marginBottom: spacing.sm,
              width: '50%',
              ...baseTint,
            })}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {box('skeleton-badge', {
                height: 20,
                borderRadius: radius.pill,
                width: 50,
                ...baseTint,
              })}
              {box('skeleton-distance', {
                height: fontSize.bodySm,
                borderRadius: radius.input,
                width: 35,
                ...baseTint,
              })}
            </View>
          </View>
        </>
      )}
    </View>
  );
};
