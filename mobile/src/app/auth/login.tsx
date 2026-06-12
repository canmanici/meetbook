import { useState } from 'react';
import { Link, router } from 'expo-router';
import { ScrollView, StyleSheet, View, useColorScheme } from 'react-native';

import { Button, InlineError, Input, palette, spacing } from '@/components/ui';
import { ApiError, login } from '@/lib/api/client';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  const setSession = useAuthStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.length > 0 && password.length > 0 && !loading;

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
        setError('E-posta veya şifre hatalı.');
      } else {
        setError('Bir şeyler ters gitti. Lütfen tekrar deneyin.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}>
      <Input
        label="E-posta"
        placeholder="ornek@eposta.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
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
      <View style={styles.linkRow}>
        <Link href="/auth/register">Hesabın yok mu? Kayıt ol</Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
    justifyContent: 'center',
    flexGrow: 1,
  },
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
});
