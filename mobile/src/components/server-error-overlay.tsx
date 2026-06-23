import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { onApiError, type ApiErrorEvent } from '@/lib/api/error-bus';
import { palette } from '@/components/ui/tokens';

const AUTO_DISMISS_MS = 4500;

/**
 * Global animated popup shown when the backend is unreachable or returns a 5xx.
 * Mounted once at the app root; listens on the API error bus. Replaces the
 * previous behaviour where a server-down request crashed the app.
 */
export function ServerErrorOverlay() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const [event, setEvent] = useState<ApiErrorEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progress = useSharedValue(0); // 0 hidden → 1 shown
  const iconPulse = useSharedValue(0);

  useEffect(() => {
    return onApiError((e) => {
      setEvent(e);
    });
  }, []);

  useEffect(() => {
    if (!event) return;
    progress.value = withSpring(1, { damping: 14, stiffness: 170, mass: 0.7 });
    iconPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 600, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      true,
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const dismiss = () => {
    progress.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setEvent)(null);
    });
  };

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 40 },
      { scale: 0.9 + progress.value * 0.1 },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.45 }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + iconPulse.value * 0.12 }],
    opacity: 0.85 + iconPulse.value * 0.15,
  }));

  if (!event) return null;

  const isNetwork = event.kind === 'network';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <Animated.View style={[styles.card, { backgroundColor: colors.surface }, cardStyle]}>
          <Animated.View style={[styles.iconCircle, iconStyle]}>
            <Ionicons
              name={isNetwork ? 'cloud-offline' : 'server'}
              size={34}
              color="#FFFFFF"
            />
          </Animated.View>
          <Text style={[styles.title, { color: colors.text }]}>
            {isNetwork ? 'Bağlantı yok' : 'Sunucu hatası'}
          </Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>
            {event.message}
          </Text>
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={dismiss}>
            <Text style={styles.buttonText}>Tamam</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 9998,
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E5645A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
  },
  button: {
    backgroundColor: '#E5645A',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
