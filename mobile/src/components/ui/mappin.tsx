import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { palette, spacing, fontSize } from './tokens';

interface BlurredAreaPinProps {
  count?: number;
  selected?: boolean;
  testID?: string;
}

export const BlurredAreaPin: React.FC<BlurredAreaPinProps> = ({
  count,
  selected = false,
  testID = 'blurred-area-pin',
}) => {
  const diameter = 24;
  const opacity = selected ? 0.6 : 0.4;
  const borderWidth = 1;
  const scale = selected ? 1.15 : 1;

  const pinStyle: ViewStyle = {
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    backgroundColor: `rgba(15, 110, 93, ${opacity})`,
    borderWidth,
    borderColor: `rgba(15, 110, 93, 0.2)`,
    transform: [{ scale }],
    justifyContent: 'center',
    alignItems: 'center',
  };

  return (
    <View style={pinStyle} testID={testID}>
      {count != null && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  countBadge: {
    backgroundColor: palette.light.primary,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  countText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: palette.light.surface,
  },
});

export type { BlurredAreaPinProps };
