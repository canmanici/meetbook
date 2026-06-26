import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Input, Skeleton, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getMe, updateMe } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';

const PHONE_RE = /^(\+90|0)?5\d{9}$/;

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (!PHONE_RE.test(cleaned)) return null;
  let digits = cleaned;
  if (digits.startsWith('+90')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return `+90 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
}

function formatDisplay(canonical: string): string {
  const local = canonical.replace(/^\+90\s?/, '');
  if (local.length !== 10) return canonical;
  return `+90 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8, 10)}`;
}

export default function TrustedContactScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: meData, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  const savedName = (meData as any)?.trusted_contact_name as string | null | undefined;
  const savedPhone = (meData as any)?.trusted_contact_phone as string | null | undefined;
  const hasContact = !!savedName && !!savedPhone;

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isLoading) {
      if (hasContact) {
        setMode('view');
      } else {
        setMode('edit');
        setName('');
        setPhone('');
      }
    }
  }, [isLoading, hasContact]);

  const startEdit = () => {
    setName(savedName ?? '');
    setPhone(savedPhone ?? '');
    setPhoneError(undefined);
    setMode('edit');
  };

  const saveMutation = useMutation({
    mutationFn: (body: { trusted_contact_name: string | null; trusted_contact_phone: string | null }) =>
      updateMe(body as any),
    onSuccess: (_data, body) => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (body.trusted_contact_name === null) {
        toast.show('Güvenilir kişi kaldırıldı', { variant: 'success' });
        setName('');
        setPhone('');
        setMode('edit');
      } else {
        toast.show('Güvenilir kişi kaydedildi', { variant: 'success' });
        setMode('view');
      }
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show('Kaydetme başarısız', { variant: 'error' });
    },
  });

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show('İsim boş olamaz', { variant: 'error' });
      return;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setPhoneError('Geçerli bir Türk cep numarası girin (+90 5XX XXX XX XX)');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setPhoneError(undefined);
    saveMutation.mutate({ trusted_contact_name: trimmedName, trusted_contact_phone: normalized });
  };

  const handleRemove = () => {
    Alert.alert(
      'Güvenilir Kişiyi Kaldır',
      'Kayıtlı güvenilir kişiyi silmek istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () =>
            saveMutation.mutate({ trusted_contact_name: null, trusted_contact_phone: null }),
        },
      ],
    );
  };

  const saving = saveMutation.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Güvendiğim Kişi</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView
        testID="trusted-scroll"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.explainer, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
          <Text style={[styles.explainerText, { color: colors.text }]}>
            Buluşma detayları bu kişiyle paylaşılır. Güvenliğiniz için güvendiğiniz bir kişiyi ekleyin.
          </Text>
        </View>

        {isLoading ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : mode === 'view' && hasContact ? (
          <View style={[styles.currentCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
            <View style={[styles.currentIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="person" size={24} color={colors.primary} />
            </View>
            <View style={styles.currentInfo}>
              <Text style={[styles.currentLabel, { color: colors.textMuted }]}>Kayıtlı güvenilir kişi</Text>
              <Text style={[styles.currentName, { color: colors.text }]}>{savedName}</Text>
              <Text style={[styles.currentPhone, { color: colors.textMuted }]} testID="trusted-current-phone">
                {formatDisplay(savedPhone!)}
              </Text>
            </View>
            <View style={styles.currentActions}>
              <TouchableOpacity
                onPress={startEdit}
                style={[styles.secondaryBtn, { borderColor: colors.primary }]}
                disabled={saving}
                testID="trusted-edit-button"
              >
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Değiştir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRemove}
                style={[styles.secondaryBtn, { borderColor: colors.danger }]}
                disabled={saving}
                testID="trusted-remove-button"
              >
                <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>Kaldır</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {hasContact ? (
              <Text style={[styles.formHint, { color: colors.textMuted }]}>
                Yeni kişi bilgilerini girin
              </Text>
            ) : (
              <Text style={[styles.formHint, { color: colors.textMuted }]}>
                Güvenilir kişinizi ekleyin
              </Text>
            )}

            <Input
              label="İsim"
              placeholder="Ad Soyad"
              value={name}
              onChangeText={setName}
              testID="trusted-name-input"
            />

            <Input
              label="Telefon"
              placeholder="+90 5XX XXX XX XX"
              value={phone}
              onChangeText={setPhone}
              error={phoneError}
              helper="Türk cep numarası: +90 5XX XXX XX XX"
              keyboardType="phone-pad"
              testID="trusted-phone-input"
            />

            <TouchableOpacity
              onPress={handleSave}
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              disabled={saving}
              activeOpacity={0.85}
              testID="trusted-save-button"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Kaydet</Text>
              )}
            </TouchableOpacity>

            {hasContact ? (
              <TouchableOpacity
                onPress={() => setMode('view')}
                style={styles.cancelBtn}
                disabled={saving}
                testID="trusted-cancel-button"
              >
                <Text style={[styles.cancelBtnText, { color: colors.textMuted }]}>Vazgeç</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  explainerText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    lineHeight: 20,
  },
  currentCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  currentIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentInfo: {
    flex: 1,
    minWidth: 140,
  },
  currentLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginBottom: 2,
  },
  currentName: {
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  currentPhone: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginTop: 2,
  },
  currentActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  formCard: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  formHint: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  saveBtn: {
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});
