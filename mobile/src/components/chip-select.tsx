import React from 'react';
import { Pressable, Text, View, StyleSheet, useColorScheme } from 'react-native';

import { palette, radius, spacing, fontSize } from '@/components/ui';

interface ChipSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  testIDPrefix?: string;
}

export function ChipSelect<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  testIDPrefix,
}: ChipSelectProps<T>) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              testID={testIDPrefix ? `${testIDPrefix}-${option}` : undefined}
              onPress={() => onChange(option)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.primary : colors.surface,
                  borderColor: selected ? colors.primary : colors.textMuted,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: selected ? colors.surface : colors.text }]}>
                {labels[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});
