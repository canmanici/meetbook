import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Step {
  label: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
}

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isDone = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;

        return (
          <View key={step.label} style={styles.step}>
            {index > 0 && (
              <View style={[styles.line, isDone && styles.lineDone]} />
            )}
            <View
              style={[
                styles.dot,
                isDone && styles.dotDone,
                isActive && styles.dotActive,
                isPending && styles.dotPending,
              ]}
            >
              <Text
                style={[
                  styles.dotText,
                  (isDone || isActive) && styles.dotTextActive,
                ]}
              >
                {isDone ? '✓' : index + 1}
              </Text>
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>
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
    backgroundColor: '#e5e7eb',
    zIndex: 0,
  },
  lineDone: {
    backgroundColor: '#0F6E5D',
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  dotDone: {
    backgroundColor: '#0F6E5D',
  },
  dotActive: {
    backgroundColor: '#0F6E5D',
    shadowColor: '#0F6E5D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  dotPending: {
    backgroundColor: '#e5e7eb',
  },
  dotText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9ca3af',
  },
  dotTextActive: {
    color: '#ffffff',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  labelActive: {
    color: '#0F6E5D',
  },
});
