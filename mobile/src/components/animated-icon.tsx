/**
 * MeetBook — Cinematic Opening Animation
 *
 * A production-level, multi-phase splash experience:
 *   1. Deep gradient background with floating atmospheric particles
 *   2. SVG book icon with glass-morphism container + expanding ring
 *   3. Staggered "Meet" + "Book" title with spring animation
 *   4. Divider line + "Kitaplar Buluşuyor" tagline
 *   5. Brand chime audio (plays once, in sync with icon reveal)
 *   6. Smooth crossfade into the app
 *
 * Total lifecycle: ~2.8s. Plays once per app session.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

// ─── Constants ──────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get('screen');
const DURATION = 2800; // Total splash lifecycle in ms
const PARTICLE_COUNT = 14;

// ═════════════════════════════════════════════════════════════════
// 1. FLOATING ATMOSPHERE PARTICLES
// ═════════════════════════════════════════════════════════════════
function Particle() {
  // Deterministic random seed — stable across re-renders
  const seed = useRef({
    x: Math.random() * W,
    y: H * (0.25 + Math.random() * 0.55),
    size: 2 + Math.random() * 6,
    delay: Math.random() * 1500,
    riseDuration: 4000 + Math.random() * 5000,
    driftX: (Math.random() - 0.5) * 80,
    peakOpacity: 0.08 + Math.random() * 0.3,
  }).current;

  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Staggered fade-in
    opacity.value = withDelay(
      seed.delay,
      withTiming(seed.peakOpacity, { duration: 600 }),
    );

    // Continuous upward drift
    translateY.value = withDelay(
      seed.delay,
      withRepeat(
        withTiming(-H * 0.35, {
          duration: seed.riseDuration,
          easing: Easing.linear,
        }),
        -1,
        false,
      ),
    );

    // Gentle horizontal sway
    translateX.value = withDelay(
      seed.delay,
      withRepeat(
        withTiming(seed.driftX, {
          duration: seed.riseDuration * 0.8,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(translateX);
      cancelAnimation(opacity);
    };
  }, [opacity, seed.delay, seed.driftX, seed.peakOpacity, seed.riseDuration, translateX, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: seed.x + translateX.value },
      { translateY: seed.y + translateY.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        animStyle,
        {
          position: 'absolute',
          width: seed.size,
          height: seed.size,
          borderRadius: seed.size / 2,
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
        },
      ]}
    />
  );
}

// ═════════════════════════════════════════════════════════════════
// 2. SVG BOOK ICON
// ═════════════════════════════════════════════════════════════════
function BookIcon({ size = 100 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* — Back cover silhouette */}
      <Rect
        x={14}
        y={20}
        width={92}
        height={82}
        rx={6}
        stroke="#FFFFFF"
        strokeWidth={1.5}
        opacity={0.2}
      />

      {/* — Left page block (subtle fill) */}
      <Path
        d="M18 26 C18 22, 22 18, 28 18 L60 18 L60 98 L28 98 C22 98, 18 94, 18 90 Z"
        fill="#FFFFFF"
        opacity={0.06}
      />

      {/* — Right page block */}
      <Path
        d="M60 18 L92 18 C98 18, 102 22, 102 26 L102 90 C102 94, 98 98, 92 98 L60 98 Z"
        fill="#FFFFFF"
        opacity={0.06}
      />

      {/* — Spine line */}
      <Path
        d="M60 18 L60 98"
        stroke="#FFFFFF"
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.35}
      />

      {/* — Left page content lines */}
      <Path d="M26 38 L52 38" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M26 50 L52 50" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M26 62 L52 62" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M28 74 L48 74" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />

      {/* — Right page content lines */}
      <Path d="M68 38 L94 38" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M68 50 L94 50" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M68 62 L94 62" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />
      <Path d="M72 74 L94 74" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.15} />

      {/* — Bookmark ribbon (brand accent) */}
      <Path
        d="M80 18 L80 8 L85 12 L90 8 L90 18"
        fill="#4FC2AB"
        opacity={0.7}
      />
    </Svg>
  );
}

// ═════════════════════════════════════════════════════════════════
// 3. KEYFRAME DEFINITIONS  (all timed relative to DURATION)
// ═════════════════════════════════════════════════════════════════

/** Whole-container lifecycle: fade in → hold → fade out */
const containerKF = new Keyframe({
  0: { opacity: 0 },
  5: { opacity: 1 },
  82: { opacity: 1 },
  100: { opacity: 0, easing: Easing.out(Easing.cubic) },
});

/** Expanding glow ring behind the icon */
const ringKF = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.6 }] },
  12: { opacity: 0.3, transform: [{ scale: 1 }] },
  28: { opacity: 0, transform: [{ scale: 1.5 }] },
  100: { opacity: 0 },
});

/** Icon box: scale spring with overshoot */
const iconKF = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.3 }] },
  10: { opacity: 1, transform: [{ scale: 1.15 }], easing: Easing.out(Easing.back(1.8)) },
  16: { transform: [{ scale: 1 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
});

/** Title "MeetBook": staggered slide-up */
const titleKF = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 35 }] },
  38: { opacity: 0, transform: [{ translateY: 35 }] },
  52: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.back(1.2)) },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
});

/** Divider line: crossfade */
const dividerKF = new Keyframe({
  0: { opacity: 0, transform: [{ scaleX: 0 }] },
  54: { opacity: 0, transform: [{ scaleX: 0 }] },
  62: { opacity: 1, transform: [{ scaleX: 1 }], easing: Easing.out(Easing.cubic) },
  100: { opacity: 1, transform: [{ scaleX: 1 }] },
});

/** Tagline: subtle fade + slide */
const taglineKF = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 12 }] },
  58: { opacity: 0, transform: [{ translateY: 12 }] },
  68: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
});

// ═════════════════════════════════════════════════════════════════
// 4. MAIN SPLASH OVERLAY
// ═════════════════════════════════════════════════════════════════

/** Ensures the splash plays exactly once per app session. */
let _hasPlayedOnce = false;

export function AnimatedSplashOverlay() {
  const [visible, setVisible] = useState(!_hasPlayedOnce);

  if (!visible) return null;
  _hasPlayedOnce = true;

  return (
    <Animated.View
      entering={containerKF.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) runOnJS(setVisible)(false);
      })}
      style={styles.container}
    >
      {/* ── Background layer ── */}
      <LinearGradient
        colors={['#11806B', '#0A5C4A', '#07382E']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.3, y: 1 }}
      />

      {/* Depth vignette: subtle darkening at bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(0, 0, 0, 0.18)']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0.3 }}
        end={{ x: 0, y: 1 }}
      />

      {/* ── Particles ── */}
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <Particle key={i} />
      ))}

      {/* ── Center content ── */}
      <View style={styles.centerContent}>
        {/* Expanding glow ring */}
        <Animated.View entering={ringKF.duration(DURATION)} style={styles.ring} />

        {/* Icon container (glass morphism) */}
        <Animated.View entering={iconKF.duration(DURATION)} style={styles.iconBox}>
          <BookIcon size={100} />
        </Animated.View>

        {/* Title — "MeetBook" with split-styling */}
        <Animated.View entering={titleKF.duration(DURATION)}>
          <View style={styles.titleRow}>
            <Text style={styles.titleMeet}>Meet</Text>
            <Text style={styles.titleBook}>Book</Text>
          </View>
        </Animated.View>

        {/* Divider line */}
        <Animated.View entering={dividerKF.duration(DURATION)} style={styles.divider} />

        {/* Tagline */}
        <Animated.View entering={taglineKF.duration(DURATION)}>
          <Text style={styles.tagline}>Kitaplar Buluşuyor</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// ═════════════════════════════════════════════════════════════════
// 5. STYLES
// ═════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  centerContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  ring: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  iconBox: {
    width: 112,
    height: 112,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    justifyContent: 'center',
    alignItems: 'center',
    /* Glass shadow */
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 20,
    /* Subtle border */
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 16,
  },
  titleMeet: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  titleBook: {
    fontSize: 36,
    fontWeight: '800',
    color: '#4FC2AB',
    letterSpacing: -1,
  },
  divider: {
    width: 48,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: 12,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.55)',
    fontWeight: '500',
    letterSpacing: 1.4,
  },
});
