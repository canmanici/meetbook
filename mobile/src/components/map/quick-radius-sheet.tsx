import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
} from "react-native";
import Slider from "@react-native-community/slider";
import { palette, spacing, fontSize, radius, shadows } from "../ui/tokens";

const RADIUS_MIN = 1;
const RADIUS_MAX = 100;

interface QuickRadiusSheetProps {
  currentRadiusKm: number;
  onRadiusChange: (radiusKm: number) => void;
  onClose: () => void;
}

export default function QuickRadiusSheet({
  currentRadiusKm,
  onRadiusChange,
  onClose,
}: QuickRadiusSheetProps) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = palette[isDark ? "dark" : "light"];
  const [value, setValue] = useState(currentRadiusKm);

  const handleValueChange = useCallback((val: number) => {
    setValue(Math.round(val));
  }, []);

  const handleSave = useCallback(() => {
    onRadiusChange(value);
    onClose();
  }, [value, onRadiusChange, onClose]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Bildirim Alanı</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.closeButton, { color: colors.textMuted }]}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        İstek listenizdeki kitaplar bu alan içinde göründüğünde bildirim alırsınız.
      </Text>

      <View style={styles.sliderContainer}>
        <Text style={[styles.radiusValue, { color: colors.primary }]}>{value} km</Text>
        <Slider
          style={styles.slider}
          minimumValue={RADIUS_MIN}
          maximumValue={RADIUS_MAX}
          value={value}
          onValueChange={handleValueChange}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.textMuted}
          thumbTintColor={colors.primary}
        />
        <View style={styles.rangeLabels}>
          <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>1 km</Text>
          <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>100 km</Text>
        </View>
      </View>

      <Text style={[styles.note, { color: colors.textMuted }]}>
        Değişiklik bir sonraki kontrol döngüsünde etkili olur.
      </Text>

      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: colors.primary }]}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>Kaydet</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: "700",
  },
  closeButton: {
    fontSize: 18,
  },
  subtitle: {
    fontSize: fontSize.caption,
    marginBottom: spacing.md,
  },
  sliderContainer: {
    marginBottom: spacing.lg,
  },
  radiusValue: {
    fontSize: fontSize.heading,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  rangeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeLabel: {
    fontSize: fontSize.caption,
  },
  note: {
    fontSize: fontSize.caption,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  saveButton: {
    paddingVertical: spacing.sm,
    borderRadius: radius.button,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: fontSize.body,
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
