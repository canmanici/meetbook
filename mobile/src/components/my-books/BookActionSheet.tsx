import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '@/components/ui';
import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';

interface ActionSheetItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: string;
  destructive?: boolean;
}

interface BookActionSheetProps {
  visible: boolean;
  onClose: () => void;
  onAction: (key: string) => void;
  bookTitle: string;
  isAvailable: boolean;
}

const ITEMS: ActionSheetItem[] = [
  { key: 'toggle', icon: 'swap-horizontal-outline', label: 'Uygunluk değiştir' },
  { key: 'edit', icon: 'create-outline', label: 'Düzenle' },
  { key: 'share', icon: 'share-outline', label: 'Paylaş' },
  { key: 'qr', icon: 'qr-code-outline', label: 'QR kod' },
  { key: 'delete', icon: 'trash-outline', label: 'Sil', destructive: true },
];

export function BookActionSheet({
  visible,
  onClose,
  onAction,
  bookTitle,
  isAvailable,
}: BookActionSheetProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const items = ITEMS.map((item) => {
    if (item.key === 'toggle') {
      return {
        ...item,
        icon: isAvailable ? 'close-circle-outline' : 'checkmark-circle-outline',
        label: isAvailable ? 'Uygun değil yap' : 'Uygun yap',
      } as ActionSheetItem;
    }
    return item;
  });

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheetContent}>
        <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
          {bookTitle}
        </Text>

        {items.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.item, { borderBottomColor: colors.border }]}
            onPress={() => {
              onAction(item.key);
              onClose();
            }}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Ionicons
              name={item.icon}
              size={20}
              color={item.destructive ? colors.danger : colors.primary}
              style={styles.itemIcon}
            />
            <Text
              style={[
                styles.itemText,
                { color: item.destructive ? colors.danger : colors.text },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingVertical: spacing.md,
  },
  sheetTitle: {
    fontSize: fontSize.body,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    minHeight: 48,
  },
  itemIcon: {
    marginRight: spacing.md,
    width: 24,
    textAlign: 'center',
  },
  itemText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
