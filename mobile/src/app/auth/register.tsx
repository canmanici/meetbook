import { useEffect, useRef, useState } from 'react';
import { Link, router } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Button, InlineError, Input, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { ApiError, checkUsernameAvailable, getMe, register } from '@/lib/api/client';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

const STRENGTH_LABELS = ['Zayıf', 'Zayıf', 'Orta', 'İyi', 'Güçlü'];
const STRENGTH_COLORS = ['', '#E5645A', '#E8A13A', '#E8C547', '#2FA36B'];

function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export default function RegisterScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  const setSession = useAuthStore((state) => state.setSession);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [kvkkConsent, setKvkkConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const usernameCheckId = useRef(0);

  const emailInvalid = email.length > 0 && !EMAIL_RE.test(email);
  const usernameInvalid = usernameTouched && username.length > 0 && !USERNAME_RE.test(username);
  const passwordStrength = passwordScore(password);
  const canSubmit =
    name.length > 0 &&
    email.length > 0 &&
    !emailInvalid &&
    password.length >= 8 &&
    USERNAME_RE.test(username) &&
    usernameStatus !== 'taken' &&
    kvkkConsent &&
    !loading;

  // Live @username availability check while typing, debounced.
  useEffect(() => {
    if (!USERNAME_RE.test(username)) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const requestId = ++usernameCheckId.current;
    const timer = setTimeout(() => {
      checkUsernameAvailable(username)
        .then((res) => {
          if (requestId !== usernameCheckId.current) return;
          setUsernameStatus(res.available ? 'available' : 'taken');
        })
        .catch(() => {
          if (requestId !== usernameCheckId.current) return;
          setUsernameStatus('idle');
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await register({ email, password, name, username, kvkk_consent: kvkkConsent });
      await setTokens(result.access_token, result.refresh_token);
      setSession(result.user, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
      });
      // A 6-digit code was emailed at sign-up (when SMTP is configured).
      const me = await getMe().catch(() => null);
      if (me && me.email_verified === false) {
        router.replace({ pathname: '/verify-email', params: { next: '/personality-books' } });
      } else {
        router.replace('/personality-books');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Bu e-posta veya kullanıcı adı zaten kayıtlı.');
      } else if (err instanceof ApiError && err.status === 422) {
        setError('Şifre en az 8 karakter olmalı.');
      } else {
        setError('Bir şeyler ters gitti. Lütfen tekrar deneyin.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      testID="auth-keyboard-view"
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: colors.accent }, shadows.float, { shadowColor: colors.accent }]}>
            <Ionicons name="person-add" size={32} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>Aramıza katıl</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            Birkaç saniyede hesabını oluştur
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <Input label="Ad Soyad" placeholder="Adınız" value={name} onChangeText={setName} />
          <Input
            label="Kullanıcı Adı"
            placeholder="kullaniciadi"
            value={username}
            onChangeText={(v) => {
              setUsernameTouched(true);
              setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
            }}
            testID="register-username-input"
            error={
              usernameInvalid
                ? 'En az 3 karakter — sadece küçük harf, rakam, alt çizgi'
                : usernameStatus === 'taken'
                  ? 'Bu kullanıcı adı alınmış'
                  : undefined
            }
          />
          {!usernameInvalid && username.length > 0 && (
            <View style={styles.usernameStatusRow}>
              {usernameStatus === 'checking' && <ActivityIndicator size="small" color={colors.textMuted} />}
              {usernameStatus === 'available' && (
                <>
                  <Ionicons name="checkmark-circle" size={16} color="#2FA36B" />
                  <Text style={[styles.usernameStatusText, { color: '#2FA36B' }]}>@{username} müsait</Text>
                </>
              )}
            </View>
          )}
          <Input
            label="E-posta"
            placeholder="ornek@eposta.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            error={emailInvalid ? 'Geçerli bir e-posta adresi girin' : undefined}
          />
          <Input
            label="Şifre"
            placeholder="En az 8 karakter"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {password.length > 0 && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBar}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.strengthSegment,
                      { backgroundColor: i < passwordStrength ? STRENGTH_COLORS[passwordStrength] : colors.surfaceAlt },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, { color: colors.textMuted }]}>
                {STRENGTH_LABELS[passwordStrength]}
              </Text>
            </View>
          )}
          <Pressable
            testID="kvkk-consent-toggle"
            onPress={() => setKvkkConsent((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: kvkkConsent }}
            style={[styles.consentRow, { backgroundColor: colors.surfaceAlt }]}>
            <Badge
              text={kvkkConsent ? 'Onaylandı' : 'Onayla'}
              variant={kvkkConsent ? 'success' : 'info'}
            />
            <Text style={[styles.consentText, { color: colors.text }]}>
              <Text onPress={() => {
                const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
                Linking.openURL(`${apiUrl.replace(/\/api\/v1$/, '')}/legal/kvkk-aydinlatma-metni`);
              }} style={{ textDecorationLine: 'underline', fontWeight: '600' }}>
                KVKK Aydınlatma Metni
              </Text>
              {' ni okudum ve kabul ediyorum.'}
            </Text>
          </Pressable>
          {error && <InlineError message={error} />}
          <Button onPress={onSubmit} disabled={!canSubmit} loading={loading}>
            Kayıt ol
          </Button>
          <GoogleSignInButton onError={setError} />
        </View>

        <View style={styles.linkRow}>
          <Link href="/auth/login" style={[styles.link, { color: colors.primary }]}>
            Hesabın var mı? Giriş yap
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.xl,
    justifyContent: 'center',
    flexGrow: 1,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  brand: {
    fontSize: fontSize.heading,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  tagline: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.field,
  },
  consentText: {
    flex: 1,
    fontSize: fontSize.bodySm,
  },
  strengthContainer: {
    gap: spacing.xs,
  },
  strengthBar: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  strengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: radius.input,
  },
  strengthLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  usernameStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -spacing.sm,
  },
  usernameStatusText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  link: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});
