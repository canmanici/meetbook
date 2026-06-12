import { useState } from 'react';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { Badge, Button, InlineError, Input, palette, spacing } from '@/components/ui';
import { ApiError, register } from '@/lib/api/client';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

export default function RegisterScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  const setSession = useAuthStore((state) => state.setSession);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [kvkkConsent, setKvkkConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    name.length > 0 && email.length > 0 && password.length >= 8 && kvkkConsent && !loading;

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await register({ email, password, name, kvkk_consent: kvkkConsent });
      await setTokens(result.access_token, result.refresh_token);
      setSession(result.user, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
      });
      router.replace('/tabs/home');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Bu e-posta zaten kayıtlı.');
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
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}>
      <Input label="Ad Soyad" placeholder="Adınız" value={name} onChangeText={setName} />
      <Input
        label="E-posta"
        placeholder="ornek@eposta.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
      />
      <Input
        label="Şifre"
        placeholder="En az 8 karakter"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Pressable
        testID="kvkk-consent-toggle"
        onPress={() => setKvkkConsent((value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: kvkkConsent }}
        style={styles.consentRow}>
        <Badge
          text={kvkkConsent ? 'Onaylandı' : 'Onayla'}
          variant={kvkkConsent ? 'success' : 'info'}
        />
        <Text style={[styles.consentText, { color: colors.text }]}>
          KVKK Aydınlatma Metni&apos;ni okudum ve kabul ediyorum.
        </Text>
      </Pressable>
      {error && <InlineError message={error} />}
      <Button onPress={onSubmit} disabled={!canSubmit} loading={loading}>
        Kayıt ol
      </Button>
      <View style={styles.linkRow}>
        <Link href="/auth/login">Hesabın var mı? Giriş yap</Link>
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
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  consentText: {
    flex: 1,
  },
  linkRow: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
});
