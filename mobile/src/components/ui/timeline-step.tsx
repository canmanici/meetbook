import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type StepStatus = 'done' | 'active' | 'pending';

interface TimelineStepProps {
  status: StepStatus;
  title: string;
  subtitle: string;
  isLast?: boolean;
}

export function TimelineStep({ status, title, subtitle, isLast = false }: TimelineStepProps) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View
          style={[
            styles.dot,
            status === 'done' && styles.dotDone,
            status === 'active' && styles.dotActive,
            status === 'pending' && styles.dotPending,
          ]}
        >
          <Text style={[styles.dotText, status !== 'pending' && styles.dotTextActive]}>
            {status === 'done' ? '✓' : status === 'active' ? '●' : '○'}
          </Text>
        </View>
        {!isLast && (
          <View style={[styles.line, status === 'done' && styles.lineDone]} />
        )}
      </View>
      <View style={[styles.right, isLast && { paddingBottom: 0 }]}>
        <Text
          style={[
            styles.title,
            status === 'active' && styles.titleActive,
            status === 'pending' && styles.titlePending,
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.subtitle,
            status === 'pending' && styles.subtitlePending,
          ]}
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  left: {
    width: 32,
    alignItems: 'center',
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  dotDone: { backgroundColor: '#dcfce7' },
  dotActive: {
    backgroundColor: '#0F6E5D',
    shadowColor: '#0F6E5D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  dotPending: { backgroundColor: '#f3f4f6' },
  dotText: { fontSize: 14, color: '#9ca3af' },
  dotTextActive: { color: '#ffffff' },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: '#e5e7eb',
    minHeight: 20,
  },
  lineDone: { backgroundColor: '#0F6E5D' },
  right: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 12,
  },
  title: { fontSize: 14, fontWeight: '600', color: '#111827' },
  titleActive: { color: '#0F6E5D', fontWeight: '700' },
  titlePending: { color: '#9ca3af' },
  subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  subtitlePending: { color: '#d1d5db' },
});
