import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';

export type SortMode = 'newest' | 'title' | 'author' | 'views';

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'newest', label: 'Yeni eklenen' },
  { key: 'title', label: 'A-Z' },
  { key: 'author', label: 'Yazar' },
  { key: 'views', label: 'Görüntülenme' },
];

interface SortMenuProps {
  current: SortMode;
  onChange: (mode: SortMode) => void;
}

export function SortMenu({ current, onChange }: SortMenuProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        style={[styles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="menu"
        accessibilityLabel={`Sırala: ${SORT_OPTIONS.find((o) => o.key === current)?.label}`}
      >
        <Ionicons name="funnel-outline" size={14} color={colors.primary} />
        <Text style={[styles.triggerText, { color: colors.primary }]}>
          {SORT_OPTIONS.find((o) => o.key === current)?.label}
        </Text>
      </TouchableOpacity>

      {open && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            activeOpacity={0}
          />
          <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {SORT_OPTIONS.map((opt) => {
              const selected = current === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => {
                    onChange(opt.key);
                    setOpen(false);
                  }}
                  style={[styles.menuItem, { borderBottomColor: colors.border }]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.menuItemText,
                      { color: selected ? colors.primary : colors.text },
                      selected && styles.menuItemTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={16} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 36,
  },
  triggerText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  menu: {
    position: 'absolute',
    top: 44,
    left: 0,
    minWidth: 160,
    borderRadius: radius.card,
    borderWidth: 1,
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    zIndex: 200,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    minHeight: 44,
  },
  menuItemText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  menuItemTextSelected: {
    fontWeight: '800',
  },
});
