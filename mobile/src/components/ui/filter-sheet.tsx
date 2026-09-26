import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing, fontSize, radius } from './tokens';

export interface FilterState {
  category: string | null;
  condition: string | null;
  language: string | null;
}

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  resultCount: number;
  initialFilters?: FilterState;
  // Radius is kept separate from FilterState so geofenceRadiusKm stays the
  // single source of truth — no sync between two states needed.
  radiusKm: number;
  onRadiusChange: (km: number) => void;
}

const CATEGORIES = [
  { value: 'fiction', label: 'Roman' },
  { value: 'non_fiction', label: 'Popüler Bilim' },
  { value: 'textbook', label: 'Ders Kitabı' },
  { value: 'comics', label: 'Çizgi Roman' },
  { value: 'children', label: 'Çocuk' },
  { value: 'poetry', label: 'Şiir' },
  { value: 'other', label: 'Diğer' },
];
const CONDITIONS = [
  { value: 'new', label: 'Yeni' },
  { value: 'like_new', label: 'Yeni Gibi' },
  { value: 'good', label: 'İyi' },
  { value: 'worn', label: 'Kullanılmış' },
];
const LANGUAGES = [
  { value: 'tr', label: 'Türkçe' },
  { value: 'en', label: 'English' },
];
const RADIUS_PRESETS = [1, 5, 10, 25, 50, 100, 200];

export function FilterSheet({ visible, onClose, onApply, resultCount, initialFilters, radiusKm, onRadiusChange }: FilterSheetProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [filters, setFilters] = useState<FilterState>(
    initialFilters ?? { category: null, condition: null, language: null },
  );
  const [localRadius, setLocalRadius] = useState(radiusKm);

  // Sync when sheet opens
  useEffect(() => {
    if (visible) {
      if (initialFilters) setFilters(initialFilters);
      setLocalRadius(radiusKm);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFilter = useCallback(
    (key: keyof FilterState, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [key]: prev[key] === value ? null : value,
      }));
    },
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters({ category: null, condition: null, language: null });
    setLocalRadius(10);
  }, []);

  const activeCount = [filters.category, filters.condition, filters.language].filter(Boolean).length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(20, insets.bottom) }]} onPress={(e) => e.stopPropagation()}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.heading, { color: colors.text }]}>Filtreler</Text>
              {activeCount > 0 && (
                <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.countBadgeText}>{activeCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {/* Category — with Tümü (All) button */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Kategori</Text>
            <View style={styles.chipRow}>
              {/* Tümü button — clears category filter */}
              <TouchableOpacity
                style={[
                  styles.chip,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  filters.category === null && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setFilters((prev) => ({ ...prev, category: null }))}
              >
                {filters.category === null && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                <Text style={[styles.chipText, { color: colors.text }, filters.category === null && { color: '#fff' }]}>
                  Tümü
                </Text>
              </TouchableOpacity>
              {CATEGORIES.map((cat) => {
                const isActive = filters.category === cat.value;
                return (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                      isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                    onPress={() => toggleFilter('category', cat.value)}
                  >
                    {isActive && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                    <Text style={[styles.chipText, { color: colors.text }, isActive && { color: '#fff' }]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Condition — with Tümü button */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Durum</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  filters.condition === null && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setFilters((prev) => ({ ...prev, condition: null }))}
              >
                {filters.condition === null && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                <Text style={[styles.chipText, { color: colors.text }, filters.condition === null && { color: '#fff' }]}>
                  Tümü
                </Text>
              </TouchableOpacity>
              {CONDITIONS.map((cond) => {
                const isActive = filters.condition === cond.value;
                return (
                  <TouchableOpacity
                    key={cond.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                      isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                    onPress={() => toggleFilter('condition', cond.value)}
                  >
                    {isActive && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                    <Text style={[styles.chipText, { color: colors.text }, isActive && { color: '#fff' }]}>
                      {cond.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Language — with Tümü button */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Dil</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  filters.language === null && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setFilters((prev) => ({ ...prev, language: null }))}
              >
                {filters.language === null && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                <Text style={[styles.chipText, { color: colors.text }, filters.language === null && { color: '#fff' }]}>
                  Tümü
                </Text>
              </TouchableOpacity>
              {LANGUAGES.map((lang) => {
                const isActive = filters.language === lang.value;
                return (
                  <TouchableOpacity
                    key={lang.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                      isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                    onPress={() => toggleFilter('language', lang.value)}
                  >
                    {isActive && <Ionicons name="checkmark" size={14} color="#fff" style={{ marginRight: 4 }} />}
                    <Text style={[styles.chipText, { color: colors.text }, isActive && { color: '#fff' }]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Radius selector — slider + preset buttons */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Arama Yarıçapı</Text>
            <View style={styles.radiusContainer}>
              <Text style={[styles.radiusValue, { color: colors.primary }]}>{localRadius} km</Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={200}
                step={1}
                value={localRadius}
                onValueChange={(val) => setLocalRadius(Math.round(val))}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.textMuted}
                thumbTintColor={colors.primary}
              />
              <View style={styles.radiusPresets}>
                {RADIUS_PRESETS.map((r) => {
                  const isActive = localRadius === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.presetBtn,
                        { backgroundColor: isActive ? colors.primary : colors.surfaceAlt, borderColor: isActive ? colors.primary : colors.border },
                      ]}
                      onPress={() => setLocalRadius(r)}
                    >
                      <Text style={[styles.presetText, { color: isActive ? '#fff' : colors.text }]}>
                        {r} km
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.resetBtn, { backgroundColor: colors.surfaceAlt }]}
              onPress={resetFilters}
            >
              <Text style={[styles.resetBtnText, { color: colors.text }]}>Sıfırla</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyBtnWrap}
              onPress={() => { onRadiusChange(localRadius); onApply(filters); }}
            >
              <LinearGradient
                colors={[colors.primary, colors.primary + 'CC']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.applyBtn}
              >
                <Text style={styles.applyBtnText}>Uygula ({resultCount})</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heading: {
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  countBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Radius selector
  radiusContainer: {
    marginTop: 4,
  },
  radiusValue: {
    fontSize: fontSize.heading,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  radiusPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    marginTop: 24,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
  },
  resetBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  applyBtnWrap: {
    flex: 2,
    borderRadius: radius.button,
    overflow: 'hidden',
    shadowColor: '#11806B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  applyBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: radius.button,
  },
  applyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
