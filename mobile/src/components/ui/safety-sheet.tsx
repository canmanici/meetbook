import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  MEETUP_SAFETY_ACK_LABEL,
  MEETUP_SAFETY_BULLETS,
  MEETUP_SAFETY_TITLE,
} from '@/constants/meetup';

import { Button } from './button';
import { Sheet } from './sheet';
import { fontSize, palette, spacing } from './tokens';

interface SafetySheetProps {
  visible: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
  loading?: boolean;
}

export const SafetySheet: React.FC<SafetySheetProps> = ({
  visible,
  onClose,
  onAcknowledge,
  loading = false,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} title={MEETUP_SAFETY_TITLE}>
      <View testID="safety-sheet-content">
        {MEETUP_SAFETY_BULLETS.map((bullet) => (
          <View key={bullet} style={styles.bulletRow}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>{bullet}</Text>
          </View>
        ))}
        <Button onPress={onAcknowledge} loading={loading} testID="safety-sheet-acknowledge">
          {MEETUP_SAFETY_ACK_LABEL}
        </Button>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  bulletRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  bulletDot: {
    fontSize: fontSize.body,
    color: palette.light.primary,
  },
  bulletText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    color: palette.light.text,
  },
});
