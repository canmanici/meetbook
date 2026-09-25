import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, InlineError, Input, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { ApiError, login } from '@/lib/api/client';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

// Login accepts either an email address or a @username — just reject
// whitespace, the server tells us which it got.
const IDENTIFIER_RE = /^\S+$/;

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  const setSession = useAuthStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailInvalid = email.length > 0 && !IDENTIFIER_RE.test(email);
  const canSubmit = email.length > 0 && !emailInvalid && password.length > 0 && !loading;

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await login({ email, password });
      await setTokens(result.access_token, result.refresh_token);
      setSession(result.user, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
      });
      router.replace('/tabs/home');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('E-posta/kullanıcı adı veya şifre hatalı.');
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
          <View style={[styles.logo, { backgroundColor: colors.primary }, shadows.float, { shadowColor: colors.primary }]}>
            <Ionicons name="swap-horizontal" size={38} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>MeetBook</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            Yakınındaki kitapseverlerle takas yap
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <Input
            label="E-posta veya Kullanıcı Adı"
            placeholder="ornek@eposta.com veya kullaniciadi"
            value={email}
            onChangeText={(v) => setEmail(v.trim())}
            autoCapitalize="none"
            error={emailInvalid ? 'Boşluk içeremez' : undefined}
          />
          <Input
            label="Şifre"
            placeholder="Şifreniz"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error && <InlineError message={error} />}
          <Button onPress={onSubmit} disabled={!canSubmit} loading={loading}>
            Giriş yap
          </Button>
          <Link href="/auth/forgot-password" style={[styles.forgotLink, { color: colors.textMuted }]}>
            Şifremi Unuttum
          </Link>
          <GoogleSignInButton onError={setError} />
        </View>

        <View style={styles.linkRow}>
          <Link href="/auth/register" style={[styles.link, { color: colors.primary }]}>
            Hesabın yok mu? Kayıt ol
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
    width: 84,
    height: 84,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  brand: {
    fontSize: fontSize.display,
    fontWeight: '900',
    letterSpacing: -0.5,
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
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  link: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  forgotLink: {
    textAlign: 'center',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
});
