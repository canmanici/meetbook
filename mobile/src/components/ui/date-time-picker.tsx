import { useState } from 'react';
import { Platform, TouchableOpacity, Text, View, useColorScheme } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/components/ui';

interface Props {
  value: Date | null;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  label?: string;
}

export function DatePicker({ value, onChange, minimumDate, label = 'Tarih ve Saat' }: Props) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [show, setShow] = useState(false);
  // Android's native picker only supports 'date' or 'time' mode, not 'datetime'.
  // So we show the date picker first, then chain into the time picker.
  const [androidStep, setAndroidStep] = useState<'date' | 'time'>('date');

  const handleChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (!selectedDate) {
        setShow(false);
        setAndroidStep('date');
        return;
      }
      if (androidStep === 'date') {
        const combined = new Date(value || new Date());
        combined.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        onChange(combined);
        setAndroidStep('time');
        return;
      }
      const combined = new Date(value || new Date());
      combined.setHours(selectedDate.getHours(), selectedDate.getMinutes());
      onChange(combined);
      setShow(false);
      setAndroidStep('date');
      return;
    }
    if (selectedDate) {
      onChange(selectedDate);
    }
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.surface, borderColor: colors.textMuted + '30' }]}
        onPress={() => setShow(true)}
        testID="date-picker-button"
      >
        <Ionicons name="calendar" size={20} color={colors.primary} />
        <View style={styles.dateInfo}>
          {value ? (
            <>
              <Text style={[styles.dateText, { color: colors.text }]}>{formatDate(value)}</Text>
              <Text style={[styles.timeText, { color: colors.textMuted }]}>{formatTime(value)}</Text>
            </>
          ) : (
            <Text style={[styles.placeholderText, { color: colors.textMuted }]}>Tarih ve saat seçin</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={value || new Date()}
          mode={Platform.OS === 'android' ? androidStep : 'datetime'}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          minimumDate={minimumDate || new Date()}
          testID="datetime-picker"
        />
      )}
    </View>
  );
}

const styles = {
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  dateInfo: {
    flex: 1,
  },
  dateText: {
    fontSize: fontSize.body,
    fontWeight: '600' as const,
  },
  timeText: {
    fontSize: fontSize.bodySm,
  },
  placeholderText: {
    fontSize: fontSize.body,
  },
};
