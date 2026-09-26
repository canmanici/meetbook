import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, useColorScheme } from 'react-native';
import { palette, spacing, radius } from './tokens';

interface TypingIndicatorProps {
  name: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ name }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      );
    };

    const anim = Animated.parallel([animate(dot1, 0), animate(dot2, 200), animate(dot3, 400)]);
    anim.start();
    return () => anim.stop();
  }, [dot1, dot2, dot3]);

  const dotStyle = (dot: Animated.Value) => ({
    transform: [
      {
        translateY: dot.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -4],
        }),
      },
    ],
  });

  return (
    <View style={styles.container}>
      <Text style={[styles.name, { color: colors.textMuted }]}>{name}</Text>
      <View style={[styles.bubble, { backgroundColor: colors.surface }]}>
        <View style={styles.dots}>
          <Animated.View style={[styles.dot, dotStyle(dot1), { backgroundColor: colors.textMuted }]} />
          <Animated.View style={[styles.dot, dotStyle(dot2), { backgroundColor: colors.textMuted }]} />
          <Animated.View style={[styles.dot, dotStyle(dot3), { backgroundColor: colors.textMuted }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 2,
    paddingLeft: 32 + 4, // avatar width + gap
  },
  name: {
    fontSize: 11,
    fontWeight: '500',
    marginRight: spacing.xs,
    marginBottom: 2,
  },
  bubble: {
    borderRadius: radius.card,
    borderBottomLeftRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    height: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
