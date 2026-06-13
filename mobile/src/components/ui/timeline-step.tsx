import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { palette } from './tokens';

type StepStatus = 'done' | 'active' | 'pending';

interface TimelineStepProps {
  status: StepStatus;
  title: string;
  subtitle: string;
  isLast?: boolean;
}

export function TimelineStep({ status, title, subtitle, isLast = false }: TimelineStepProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View
          style={[
            styles.dot,
            status === 'done' && { backgroundColor: colors.success + '30' },
            status === 'active' && { backgroundColor: colors.primary, shadowColor: colors.primary },
            status === 'pending' && { backgroundColor: colors.textMuted + '20' },
          ]}
        >
          <Text style={[styles.dotText, { color: status !== 'pending' ? colors.surface : colors.textMuted }]}>
            {status === 'done' ? '✓' : status === 'active' ? '●' : '○'}
          </Text>
        </View>
        {!isLast && (
          <View style={[styles.line, { backgroundColor: status === 'done' ? colors.primary : colors.textMuted + '30' }]} />
        )}
      </View>
      <View style={[styles.right, isLast && { paddingBottom: 0 }]}>
        <Text
          style={[
            styles.title,
            { color: status === 'active' ? colors.primary : status === 'pending' ? colors.textMuted : colors.text },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: status === 'pending' ? colors.textMuted + '60' : colors.textMuted },
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
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  dotText: { fontSize: 14 },
  line: {
    width: 2,
    flex: 1,
    minHeight: 20,
  },
  right: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 12,
  },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
});
