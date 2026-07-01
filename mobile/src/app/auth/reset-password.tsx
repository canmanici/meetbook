import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { Button, Input, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { apiClient } from '@/lib/api/client';

export default function ResetPasswordScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  const { token } = useLocalSearchParams<{ token: string }>();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    password.length >= 8 && confirmPassword.length >= 8 && passwordsMatch && !loading;

  const onSubmit = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/password-reset-confirm', {
        token,
        new_password: password,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw { body: data };
      }
      Alert.alert('Başarılı', 'Şifren başarıyla sıfırlandı. Yeni şifrenle giriş yapabilirsin.', [
        { text: 'Giriş Yap', onPress: () => router.replace('/auth/login') },
      ]);
    } catch (err: any) {
      const message = err?.body?.detail || 'Bir hata oluştu. Lütfen tekrar deneyin.';
      Alert.alert('Hata', message);
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
            <Ionicons name="lock-open" size={32} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>Yeni Şifre Belirle</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            En az 8 karakter uzunluğunda bir şifre seç
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <Input
            label="Yeni Şifre"
            placeholder="En az 8 karakter"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Input
            label="Şifre Tekrar"
            placeholder="Şifreni tekrar gir"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            error={confirmPassword.length > 0 && !passwordsMatch ? 'Şifreler eşleşmiyor' : undefined}
          />
          <Button onPress={onSubmit} disabled={!canSubmit} loading={loading}>
            Şifreyi Sıfırla
          </Button>
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
});
