import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input, palette, radius, shadows, spacing, fontSize } from '@/components/ui';
import { getMe } from '@/lib/api/client';
import { redeemStudentCode } from '@/lib/api/teachers';
import { apiErrorDetail } from '@/lib/exchange-errors';

const ONBOARDING_NEXT = '/personality-books';

type Step = 'code' | 'done';

/** "abcd efgh" / "ABCD-EFGH" → "ABCD-EFGH" while typing. */
function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function errorMessage(err: unknown): string {
  switch (apiErrorDetail(err)) {
    case 'INVALID_STUDENT_CODE':
      return 'Kod geçersiz, kullanılmış veya süresi dolmuş. Öğretmeninden yeni bir kod iste.';
    case 'ALREADY_STUDENT':
      return 'Öğrenci hesabın zaten doğrulanmış.';
    default:
      return 'Bir hata oluştu. Lütfen tekrar dene.';
  }
}

/**
 * Student verification — demo stage: a verified teacher gives the student a
 * one-time class code. (.edu.tr email verification exists in the backend and
 * comes back once universities are on board.)
 */
export default function StudentVerificationScreen() {
  const colors = palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // During sign-up this is one onboarding step: skippable, continues onward.
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const inOnboarding = onboarding === '1';
  const continueOnboarding = () => router.replace(ONBOARDING_NEXT as never);

  // Already a verified student (e.g. signed up with a verified .edu.tr address).
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => getMe(), enabled: inOnboarding });
  useEffect(() => {
    if (inOnboarding && me?.edu_verified) continueOnboarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOnboarding, me?.edu_verified]);

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    setError(null);
    setLoading(true);
    try {
      await redeemStudentCode(code);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('done');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { backgroundColor: colors.surface, paddingTop: insets.top + spacing.md }]}>
        {!inOnboarding && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>Öğrenci Doğrulama</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: colors.primary }, shadows.card]}>
            <Ionicons name={step === 'done' ? 'checkmark' : 'school'} size={34} color="#fff" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            {step === 'done' ? 'Öğrenci hesabın hazır!' : 'Öğrenci misin?'}
          </Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            {step === 'code'
              ? 'Öğretmeninden aldığın 8 haneli kodu gir: 1 hoş geldin kredisi ve 2 kredi borç hakkı kazan.'
              : '1 hoş geldin kredin hesabına eklendi. 2 krediye kadar borçlanarak da kitap alabilirsin.'}
          </Text>
        </View>

        {step === 'code' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Input
              label="Öğrenci kodu"
              placeholder="ABCD-EFGH"
              value={code}
              onChangeText={(v) => setCode(formatCode(v))}
              autoCapitalize="characters"
              error={error ?? undefined}
              testID="student-code-input"
            />
            <Button
              onPress={verify}
              disabled={code.replace('-', '').length !== 8 || loading}
              loading={loading}
              testID="student-code-verify"
            >
              Doğrula
            </Button>
          </View>
        )}

        {step === 'done' &&
          (inOnboarding ? (
            <Button onPress={continueOnboarding} testID="student-continue">
              Devam et
            </Button>
          ) : (
            <Button
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings/credits' as any)
              }
              testID="student-go-credits"
            >
              Kredilerimi gör
            </Button>
          ))}

        {step !== 'done' && (
          <View style={styles.altRow}>
            {inOnboarding && (
              <TouchableOpacity onPress={continueOnboarding} testID="student-skip" accessibilityRole="button">
                <Text style={[styles.link, { color: colors.textMuted }]}>
                  Şimdilik atla — kodu sonra da girebilirsin
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/settings/teacher' as any)}
              testID="student-teacher-link"
              accessibilityRole="button"
            >
              <Text style={[styles.link, { color: colors.primary }]}>Öğretmen misin? Başvur</Text>
            </TouchableOpacity>
          </View>
        )}

        {step !== 'done' && (
          <Text style={[styles.note, { color: colors.textMuted }]}>
            Kodlar tek kullanımlıktır ve 14 gün geçerlidir. Kodu MeetBook’un onayladığı öğretmenler verir.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  hero: { alignItems: 'center' },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontSize: fontSize.heading, fontWeight: '900', textAlign: 'center' },
  tagline: { fontSize: fontSize.bodySm, fontWeight: '500', marginTop: spacing.xs, textAlign: 'center', lineHeight: 20 },
  card: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  link: { fontSize: fontSize.bodySm, fontWeight: '700' },
  altRow: { alignItems: 'center', gap: spacing.md },
  note: { fontSize: fontSize.caption, textAlign: 'center', lineHeight: 18 },
});
