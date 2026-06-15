import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { palette } from './tokens';

interface Step {
  label: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
}

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isDone = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;
        const isPrevDone = index <= currentStep;

        return (
          <View key={step.label} style={styles.step}>
            {index > 0 && (
              <View style={[styles.line, { backgroundColor: isPrevDone ? colors.primary : colors.textMuted + '30' }]} />
            )}
            <View
              style={[
                styles.dot,
                isDone && { backgroundColor: colors.primary },
                isActive && { backgroundColor: colors.primary, shadowColor: colors.primary },
                isPending && { backgroundColor: colors.textMuted + '30' },
              ]}
            >
              <Text
                style={[
                  styles.dotText,
                  { color: (isDone || isActive) ? colors.surface : colors.textMuted },
                ]}
              >
                {isDone ? '✓' : index + 1}
              </Text>
            </View>
            <Text style={[styles.label, { color: isActive ? colors.primary : colors.textMuted }]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  line: {
    position: 'absolute',
    top: 15,
    left: '50%',
    width: '100%',
    height: 2,
    zIndex: 0,
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
  dotText: {
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
});
