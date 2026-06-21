import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, shadows } from './tokens';

interface VoiceRecorderProps {
  onSend: (durationMs: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSend, onCancel }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const [isRecording, setIsRecording] = useState(true);
  const [duration, setDuration] = useState(0);
  const [waveform] = useState(() => Array.from({ length: 30 }, () => 0.2 + Math.random() * 0.8));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Start recording timer
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 100);
    }, 100);

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    ).start();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleSend = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    onSend(duration);
  };

  const handleCancel = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    onCancel();
  };

  const formatDuration = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, ...shadows.sheet }]}>
      {/* Cancel */}
      <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
        <Ionicons name="trash" size={22} color={colors.danger} />
      </TouchableOpacity>

      {/* Waveform */}
      <View style={styles.waveformContainer}>
        <View style={styles.waveform}>
          {waveform.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h * 28,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Duration + recording indicator */}
      <View style={styles.durationRow}>
        <Animated.View
          style={[
            styles.recDot,
            { backgroundColor: colors.danger, transform: [{ scale: pulseAnim }] },
          ]}
        />
        <Text style={[styles.duration, { color: colors.text }]}>
          {formatDuration(duration)}
        </Text>
      </View>

      {/* Send */}
      <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
        <Ionicons name="send" size={20} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  cancelBtn: {
    padding: spacing.xs,
  },
  waveformContainer: {
    flex: 1,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 28,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  duration: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    minWidth: 40,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.float,
  },
});
