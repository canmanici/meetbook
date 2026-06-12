import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { palette, spacing, fontSize } from './tokens';

interface BlurredAreaPinProps {
  count?: number;
  selected?: boolean;
  testID?: string;
}

export type ExactPinVariant = 'default' | 'selected' | 'pending';

interface ExactPinProps {
  variant?: ExactPinVariant;
  testID?: string;
}

export const ExactPin: React.FC<ExactPinProps> = ({
  variant = 'default',
  testID = 'exact-pin',
}) => {
  const bodySize = 16;
  const stemHeight = 12;
  const stemWidth = 10;
  const innerDotSize = 4;

  const isPending = variant === 'pending';
  const isSelected = variant === 'selected';
  const fillColor = isPending ? palette.light.accent : palette.light.primary;
  const scale = isSelected ? 1.15 : 1;

  return (
    <View
      style={[
        styles.exactContainer,
        { transform: [{ scale }] },
        isSelected && styles.exactShadow,
      ]}
      testID={testID}
    >
      <View style={[styles.exactBody, { backgroundColor: fillColor, width: bodySize, height: bodySize, borderRadius: bodySize / 2 }]}>
        <View
          style={[
            styles.exactInner,
            { width: innerDotSize, height: innerDotSize, borderRadius: innerDotSize / 2 },
          ]}
          testID="exact-pin-inner"
        />
      </View>
      <View
        style={[
          styles.exactStem,
          {
            width: 0,
            height: 0,
            borderLeftWidth: stemWidth / 2,
            borderRightWidth: stemWidth / 2,
            borderTopWidth: stemHeight,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: fillColor,
          },
        ]}
      />
    </View>
  );
};

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
  exactContainer: {
    alignItems: 'center',
  },
  exactBody: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  exactInner: {
    backgroundColor: palette.light.surface,
  },
  exactStem: {},
  exactShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
});

export type { BlurredAreaPinProps, ExactPinVariant };
