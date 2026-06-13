import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';

interface FilterState {
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
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <View style={styles.content}>
        <Text style={styles.heading}>Filtreler</Text>

        <Text style={styles.sectionLabel}>Kategori</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, filters.category === cat && styles.chipActive]}
              onPress={() => toggleFilter('category', cat)}
            >
              <Text style={[styles.chipText, filters.category === cat && styles.chipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Durum</Text>
        <View style={styles.chipRow}>
          {CONDITIONS.map((cond) => (
            <TouchableOpacity
              key={cond}
              style={[styles.chip, filters.condition === cond && styles.chipActive]}
              onPress={() => toggleFilter('condition', cond)}
            >
              <Text style={[styles.chipText, filters.condition === cond && styles.chipTextActive]}>
                {cond}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Dil</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.chip, filters.language === lang && styles.chipActive]}
              onPress={() => toggleFilter('language', lang)}
            >
              <Text style={[styles.chipText, filters.language === lang && styles.chipTextActive]}>
                {lang}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.resetBtn} onPress={resetFilters}>
            <Text style={styles.resetBtnText}>Sıfırla</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={() => onApply(filters)}>
            <Text style={styles.applyBtnText}>Uygula ({resultCount})</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: { backgroundColor: '#ffffff', borderRadius: 20 },
  indicator: { backgroundColor: '#d1d5db', width: 40 },
  content: { flex: 1, padding: 20 },
  heading: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 20 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 16,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: '#f3f4f6' },
  chipActive: { backgroundColor: '#0F6E5D' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  chipTextActive: { color: '#ffffff' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 24 },
  resetBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#f3f4f6', alignItems: 'center' },
  resetBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  applyBtn: { flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: '#0F6E5D', alignItems: 'center' },
  applyBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});
