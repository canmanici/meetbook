import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Button, Input, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { apiClient } from '@/lib/api/client';

export default function ForgotPasswordScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/password-reset-request', { email });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw { body: data };
      }
      setSubmitted(true);
      // Straight to the code-entry screen; the email is carried over.
      router.push({ pathname: '/auth/reset-password', params: { email: email.trim() } });
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
          <View style={[styles.logo, { backgroundColor: colors.primary }, shadows.float, { shadowColor: colors.primary }]}>
            <Ionicons name="mail-unread" size={34} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>Şifre Sıfırla</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            E-posta adresine 6 haneli bir sıfırlama kodu göndereceğiz
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          {submitted ? (
            <View style={styles.success}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={[styles.successText, { color: colors.text }]}>
                E-postana sıfırlama kodu gönderildi
              </Text>
            </View>
          ) : (
            <>
              <Input
                label="E-posta"
                placeholder="ornek@eposta.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
              />
              <Button onPress={onSubmit} disabled={email.length === 0 || loading} loading={loading}>
                Kod gönder
              </Button>
            </>
          )}
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
  success: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  successText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    textAlign: 'center',
  },
});
