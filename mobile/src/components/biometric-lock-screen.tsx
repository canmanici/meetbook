import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, palette, spacing, fontSize, radius } from '@/components/ui';
import { authenticateWithBiometrics, getBiometricTypeLabel } from '@/lib/biometric';

interface BiometricLockScreenProps {
  onUnlock: () => void;
}

/**
 * Full-screen gate shown when biometric app-lock is enabled — blocks the app
 * content until Face ID / fingerprint succeeds. Not a login screen: the
 * session (tokens) is already there, this only re-proves it's the same
 * person holding the device before revealing it.
 */
export function BiometricLockScreen({ onUnlock }: BiometricLockScreenProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const [label, setLabel] = useState('Biyometrik Kilit');
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getBiometricTypeLabel().then(setLabel);
  }, []);

  const attempt = async () => {
    setAuthenticating(true);
    setFailed(false);
    const ok = await authenticateWithBiometrics(`MeetBook'a devam etmek için doğrula`);
    setAuthenticating(false);
    if (ok) {
      onUnlock();
    } else {
      setFailed(true);
    }
  };

  useEffect(() => {
    attempt();
    // Only on mount — re-attempts are user-triggered via the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
        <Ionicons name="finger-print" size={48} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>MeetBook Kilitli</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {authenticating ? `${label} bekleniyor…` : failed ? 'Doğrulanamadı' : `${label} ile devam et`}
      </Text>
      <Button onPress={attempt} disabled={authenticating} testID="biometric-retry-button">
        {`${label} ile Aç`}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.md,
  },
});
