import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing } from './tokens';
import type { MessageView } from '@/lib/api/chat';

interface VoiceMessageProps {
  message: MessageView;
  isMine: boolean;
}

// Fake waveform bars (in real app, parse audio buffer)
const generateWaveform = (count: number): number[] => {
  const bars = [];
  for (let i = 0; i < count; i++) {
    bars.push(0.2 + Math.random() * 0.8);
  }
  return bars;
};

export const VoiceMessage: React.FC<VoiceMessageProps> = ({ message, isMine }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const duration = message.extra?.duration_seconds ?? 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const waveform = useRef(generateWaveform(30)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      setIsPlaying(true);
      setProgress(0);
      const interval = 100;
      const totalMs = duration * 1000;
      timerRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= totalMs) {
            clearInterval(timerRef.current!);
            setIsPlaying(false);
            return 0;
          }
          return prev + interval;
        });
      }, interval);
    }
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressRatio = duration > 0 ? progress / (duration * 1000) : 0;

  return (
    <View style={[styles.container, isMine ? styles.myContainer : styles.otherContainer]}>
      <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color={isMine ? '#ffffff' : colors.primary}
        />
      </TouchableOpacity>

      <View style={styles.waveformContainer}>
        {/* Waveform bars */}
        <View style={styles.waveform}>
          {waveform.map((height, i) => {
            const barProgress = i / waveform.length;
            const isActive = barProgress <= progressRatio;
            return (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: height * 24,
                    backgroundColor: isActive
                      ? isMine ? 'rgba(255,255,255,0.9)' : colors.primary
                      : isMine ? 'rgba(255,255,255,0.3)' : colors.textMuted + '40',
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Duration */}
        <Text style={[styles.duration, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
          {isPlaying ? formatDuration(progress / 1000) : formatDuration(duration)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    minWidth: 200,
  },
  myContainer: {},
  otherContainer: {},
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveformContainer: {
    flex: 1,
    gap: 4,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 24,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  duration: {
    fontSize: 11,
    fontWeight: '500',
  },
});
