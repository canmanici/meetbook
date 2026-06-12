import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize, shadows } from './tokens';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const Sheet: React.FC<SheetProps> = ({
  visible,
  onClose,
  title,
  children,
  style,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={[styles.sheet, style]} testID="sheet-container">
          <View style={styles.header}>
            <View style={styles.handle} />
            {title && <Text style={styles.title}>{title}</Text>}
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              testID="close-button"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.content}>{children}</View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.light.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '90%',
    ...shadows.sheet,
  },
  header: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: palette.light.textMuted,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '600',
    color: palette.light.text,
  },
  closeButton: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    padding: spacing.xs,
  },
  closeText: {
    fontSize: fontSize.title,
    color: palette.light.textMuted,
  },
  content: {
    padding: spacing.md,
  },
});
