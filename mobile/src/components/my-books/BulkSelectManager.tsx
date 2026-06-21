import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';

/* ─── Hook ─── */

export function useBulkSelect() {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const enter = useCallback(() => {
    setIsSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exit = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  return { isSelectMode, selectedIds, enter, exit, toggle, selectAll, count: selectedIds.size };
}

/* ─── Header ─── */

export function BulkSelectHeader({
  count,
  onClose,
  onSelectAll,
}: {
  count: number;
  onClose: () => void;
  onSelectAll: () => void;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <View style={[styles.selectHeader, { backgroundColor: colors.primary }]}>
      <TouchableOpacity
        onPress={onClose}
        style={styles.selectBackBtn}
        accessibilityLabel="Çık"
      >
        <Ionicons name="close" size={20} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.selectCount}>{count} kitap seçili</Text>
      <TouchableOpacity
        onPress={onSelectAll}
        style={styles.selectAllBtn}
        accessibilityLabel="Tümünü seç"
      >
        <Text style={styles.selectAllText}>Tümünü seç</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ─── FAB ─── */

export function BulkSelectFab({
  count,
  onDelete,
  onToggleAvailability,
}: {
  count: number;
  onDelete: () => void;
  onToggleAvailability: (setAvailable: boolean) => void;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        style={[styles.fabMenu, { backgroundColor: colors.danger }]}
        activeOpacity={0.85}
        accessibilityLabel="Toplu işlemler"
      >
        <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
      </TouchableOpacity>

      {open && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.popup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.popupItem, { borderBottomColor: colors.border }]}
              onPress={() => { setOpen(false); onToggleAvailability(true); }}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={[styles.popupText, { color: colors.text }]}>Tümünü uygun yap</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.popupItem, { borderBottomColor: colors.border }]}
              onPress={() => { setOpen(false); onToggleAvailability(false); }}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={[styles.popupText, { color: colors.text }]}>Tümünü uygun değil yap</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.popupItem}
              onPress={() => { setOpen(false); onDelete(); }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.popupText, { color: colors.danger }]}>Sil ({count})</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  selectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    minHeight: 50,
  },
  selectBackBtn: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  selectCount: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    color: '#fff',
  },
  selectAllBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.button,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  selectAllText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: '#fff',
  },
  fabMenu: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E5645A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  popup: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    minWidth: 200,
    borderRadius: radius.card,
    borderWidth: 1,
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    zIndex: 200,
  },
  popupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    minHeight: 44,
  },
  popupText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});
