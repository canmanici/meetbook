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
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Button, Input, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { ApiError, resendVerificationEmail, setVerifyScreenOpen, verifyEmail } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

const RESEND_COOLDOWN_S = 60;

/**
 * Email verification — the backend mails a 6-digit code at sign-up (only when
 * SMTP is configured). Verified-only actions (adding books, exchanges, clubs…)
 * return 403 until this is done; the API client routes those 403s here.
 */
export default function VerifyEmailScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const { next } = useLocalSearchParams<{ next?: string }>();
  const email = useAuthStore((s) => s.user?.email);
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The sign-up email was just sent — start with a cooldown.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  // Tell the API client we're showing, so a 403 elsewhere doesn't stack
  // another copy of this screen on top.
  useEffect(() => {
    setVerifyScreenOpen(true);
    return () => setVerifyScreenOpen(false);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const leave = () => {
    if (next) router.replace(next as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/tabs/home');
  };

  const onVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      await verifyEmail(code);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      leave();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? 'Kod hatalı veya süresi dolmuş. Yeni kod isteyebilirsin.'
          : 'Bir hata oluştu. Lütfen tekrar deneyin.',
      );
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setInfo(null);
    try {
      await resendVerificationEmail();
      setInfo('Yeni kod gönderildi.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Yeni kod istemeden önce biraz bekle.'
          : 'Kod gönderilemedi. Lütfen tekrar deneyin.',
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: colors.primary }, shadows.float, { shadowColor: colors.primary }]}>
            <Ionicons name="mail-open" size={34} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>E-postanı Doğrula</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            {email ? `${email} adresine` : 'E-posta adresine'} 6 haneli bir kod gönderdik
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <Input
            label="Doğrulama kodu"
            placeholder="123456"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            error={error ?? undefined}
            helper={info ?? undefined}
            testID="verify-code-input"
          />
          <Button onPress={onVerify} disabled={code.length !== 6 || loading} loading={loading} testID="verify-submit">
            Doğrula
          </Button>
          <TouchableOpacity
            onPress={onResend}
            disabled={cooldown > 0}
            style={styles.linkBtn}
            testID="verify-resend"
            accessibilityRole="button"
          >
            <Text style={[styles.link, { color: cooldown > 0 ? colors.textMuted : colors.primary }]}>
              {cooldown > 0 ? `Yeni kod iste (${cooldown} sn)` : 'Yeni kod iste'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={leave} style={styles.linkBtn} testID="verify-later" accessibilityRole="button">
            <Text style={[styles.link, { color: colors.textMuted }]}>Daha sonra</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.note, { color: colors.textMuted }]}>
          Kitap eklemek, takas yapmak ve kulüp kurmak için e-posta doğrulaması gerekir. Kodu göremiyorsan
          gereksiz/spam klasörüne bak.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, justifyContent: 'center', flexGrow: 1 },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  brand: { fontSize: fontSize.display, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' },
  tagline: { fontSize: fontSize.bodySm, fontWeight: '500', marginTop: spacing.xs, textAlign: 'center' },
  card: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  linkBtn: { alignItems: 'center', paddingVertical: spacing.xs },
  link: { fontSize: fontSize.bodySm, fontWeight: '700' },
  note: { fontSize: fontSize.caption, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
