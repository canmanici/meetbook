import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { radius, fontSize, spacing } from './tokens';
import type { ToastVariant } from './toast-provider';

const TOAST_HEIGHT = 72;
const STATUS_BAR_TOP = Platform.OS === 'ios' ? 54 : 44;

export interface AnimatedToastHandle {
  dismiss: () => void;
}

interface AnimatedToastProps {
  message: string;
  variant: ToastVariant;
  duration: number;
  iconName?: string;
  onDismiss: () => void;
}

const VARIANT_CONFIG: Record<
  ToastVariant,
  {
    gradient: [string, string];
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
  }
> = {
  success: {
    gradient: ['#3DDC84', '#0E9F6E'] as [string, string],
    icon: 'checkmark-circle',
    iconColor: '#FFFFFF',
  },
  error: {
    gradient: ['#E5645A', '#C84038'] as [string, string],
    icon: 'close-circle',
    iconColor: '#FFFFFF',
  },
  info: {
    gradient: ['#5B9BD5', '#3A7BBF'] as [string, string],
    icon: 'information-circle',
    iconColor: '#FFFFFF',
  },
};

export const AnimatedToast = forwardRef<AnimatedToastHandle, AnimatedToastProps>(
  function AnimatedToast({ message, variant, duration, iconName, onDismiss }, ref) {
    const config = VARIANT_CONFIG[variant];
    const icon = (iconName as keyof typeof Ionicons.glyphMap) ?? config.icon;

    const [visible, setVisible] = useState(true);

    // Animation values
    const translateY = useSharedValue(-TOAST_HEIGHT - STATUS_BAR_TOP - 20);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.85);
    const dismissProgress = useSharedValue(0);
    const glow = useSharedValue(0);

    // Entrance animation
    React.useEffect(() => {
      // Slide in from top with bounce
      translateY.value = withSpring(0, {
        damping: 14,
        stiffness: 180,
        mass: 0.6,
        velocity: 8,
      });
      opacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) });
      scale.value = withSpring(1, {
        damping: 12,
        stiffness: 200,
        mass: 0.5,
      });

      if (variant === 'success') {
        // Extreme celebratory pulse: quick double-bounce + glowing halo loop
        scale.value = withSequence(
          withSpring(1.06, { damping: 6, stiffness: 260, mass: 0.5 }),
          withSpring(1, { damping: 10, stiffness: 220, mass: 0.5 }),
        );
        glow.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }),
            withTiming(0.3, { duration: 700, easing: Easing.in(Easing.quad) }),
          ),
          -1,
          true,
        );
      }
    }, [glow, opacity, scale, translateY, variant]);

    const dismiss = useCallback(() => {
      'worklet';
      translateY.value = withTiming(
        -TOAST_HEIGHT - STATUS_BAR_TOP - 20,
        { duration: 250, easing: Easing.in(Easing.cubic) },
        () => {
          runOnJS(setVisible)(false);
          runOnJS(onDismiss)();
        },
      );
      opacity.value = withTiming(0, { duration: 200 });
      scale.value = withTiming(0.8, { duration: 200 });
    }, [onDismiss, opacity, scale, translateY]);

    useImperativeHandle(ref, () => ({
      dismiss: () => {
        runOnJS(dismiss)();
      },
    }), [dismiss]);

    // Swipe up to dismiss gesture
    const panGesture = Gesture.Pan()
      .onStart(() => {
        dismissProgress.value = 0;
      })
      .onUpdate((event) => {
        // Only allow upward swipes
        if (event.translationY < 0) {
          dismissProgress.value = Math.min(Math.abs(event.translationY) / TOAST_HEIGHT, 1);
          translateY.value = withTiming(event.translationY, { duration: 0 });
          opacity.value = withTiming(1 - dismissProgress.value * 0.5, { duration: 0 });
          scale.value = withTiming(1 - dismissProgress.value * 0.15, { duration: 0 });
        }
      })
      .onEnd((event) => {
        if (event.translationY < -TOAST_HEIGHT * 0.35) {
          // Swipe far enough — dismiss
          dismiss();
        } else {
          // Snap back
          translateY.value = withSpring(0, { damping: 16, stiffness: 200 });
          opacity.value = withTiming(1, { duration: 200 });
          scale.value = withSpring(1, { damping: 16, stiffness: 200 });
        }
      });

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    }));

    const haloStyle = useAnimatedStyle(() => ({
      opacity: glow.value * 0.6,
      transform: [{ scale: 1 + glow.value * 0.06 }],
    }));

    if (!visible) return null;

    return (
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.container, animatedStyle]}>
          {variant === 'success' && (
            <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
          )}
          <LinearGradient
            colors={config.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.gradient, variant === 'success' && styles.gradientSuccess]}
          >
            {/* Glow effect */}
            <LinearGradient
              colors={['rgba(255,255,255,0.15)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            {/* Icon */}
            <Ionicons name={icon} size={26} color={config.iconColor} style={styles.icon} />

            {/* Message */}
            <Text style={styles.message} numberOfLines={2}>
              {message}
            </Text>

            {/* Dismiss touch target */}
            <Ionicons name="chevron-up" size={18} color="rgba(255,255,255,0.6)" style={styles.dismissHint} />
          </LinearGradient>
        </Animated.View>
      </GestureDetector>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: STATUS_BAR_TOP,
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    elevation: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: TOAST_HEIGHT,
    borderRadius: radius.button,
    overflow: 'hidden',
  },
  gradientSuccess: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#3DDC84',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  halo: {
    position: 'absolute',
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: radius.button + 8,
    backgroundColor: '#3DDC84',
  },
  icon: {
    marginRight: spacing.md,
    flexShrink: 0,
  },
  message: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: fontSize.body,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  dismissHint: {
    marginLeft: spacing.sm,
    flexShrink: 0,
    opacity: 0.6,
  },
});
