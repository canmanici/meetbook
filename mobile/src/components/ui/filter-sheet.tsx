import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { palette } from './tokens';

export interface FilterState {
  category: string | null;
  condition: string | null;
  language: string | null;
  radiusKm: number;
}

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  resultCount: number;
}

const CATEGORIES = ['Roman', 'Ders Kitabı', 'Çizgi Roman', 'Çocuk', ' Şiir', 'Diğer'];
const CONDITIONS = ['Yeni', 'Yeni Gibi', 'İyi', 'Kullanılmış'];
const LANGUAGES = ['Türkçe', 'English'];

export function FilterSheet({ visible, onClose, onApply, resultCount }: FilterSheetProps) {
  const sheetRef = React.useRef<BottomSheet>(null);
  const snapPoints = React.useMemo(() => ['70%'], []);
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  const [filters, setFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
    radiusKm: 10,
  });

  const toggleFilter = useCallback(
    (key: keyof FilterState, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [key]: prev[key] === value ? null : value,
      }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters({ category: null, condition: null, language: null, radiusKm: 10 });
  }, []);

  React.useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={[styles.background, { backgroundColor: colors.surface }]}
      handleIndicatorStyle={[styles.indicator, { backgroundColor: colors.textMuted }]}
    >
      <View style={styles.content}>
        <Text style={[styles.heading, { color: colors.text }]}>Filtreler</Text>

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Kategori</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, { backgroundColor: colors.textMuted + '20' }, filters.category === cat && { backgroundColor: colors.primary }]}
              onPress={() => toggleFilter('category', cat)}
            >
              <Text style={[styles.chipText, { color: colors.textMuted }, filters.category === cat && { color: colors.surface }]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Durum</Text>
        <View style={styles.chipRow}>
          {CONDITIONS.map((cond) => (
            <TouchableOpacity
              key={cond}
              style={[styles.chip, { backgroundColor: colors.textMuted + '20' }, filters.condition === cond && { backgroundColor: colors.primary }]}
              onPress={() => toggleFilter('condition', cond)}
            >
              <Text style={[styles.chipText, { color: colors.textMuted }, filters.condition === cond && { color: colors.surface }]}>
                {cond}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Dil</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.chip, { backgroundColor: colors.textMuted + '20' }, filters.language === lang && { backgroundColor: colors.primary }]}
              onPress={() => toggleFilter('language', lang)}
            >
              <Text style={[styles.chipText, { color: colors.textMuted }, filters.language === lang && { color: colors.surface }]}>
                {lang}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.resetBtn, { backgroundColor: colors.textMuted + '20' }]} onPress={resetFilters}>
            <Text style={[styles.resetBtnText, { color: colors.text }]}>Sıfırla</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.applyBtn, { backgroundColor: colors.primary }]} onPress={() => onApply(filters)}>
            <Text style={[styles.applyBtnText, { color: colors.surface }]}>Uygula ({resultCount})</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: { borderRadius: 20 },
  indicator: { width: 40 },
  content: { flex: 1, padding: 20 },
  heading: { fontSize: 20, fontWeight: '800', marginBottom: 20 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 16,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  chipText: { fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 24 },
  resetBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  resetBtnText: { fontSize: 14, fontWeight: '700' },
  applyBtn: { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  applyBtnText: { fontSize: 14, fontWeight: '700' },
});
