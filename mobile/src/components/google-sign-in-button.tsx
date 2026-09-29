import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { palette, spacing, fontSize, radius } from '@/components/ui';
import { ApiError, loginWithGoogle, type GoogleLoginResponse } from '@/lib/api/client';
import { GoogleSignInError, getGoogleIdToken, isGoogleSignInAvailable } from '@/lib/google-signin';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

const KVKK_URL = `${(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1').replace(/\/api\/v1$/, '')}/legal/kvkk-aydinlatma-metni`;

/** Ask for KVKK consent (required before a Google sign-in creates an account). */
function askKvkkConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'KVKK Onayı',
      'Google hesabınla yeni bir MeetBook hesabı oluşturulacak. Devam etmek için KVKK Aydınlatma Metni’ni okuyup kabul etmen gerekiyor.',
      [
        { text: 'Metni oku', onPress: () => { Linking.openURL(KVKK_URL); resolve(false); } },
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Kabul ediyorum', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function messageFor(e: unknown): string {
  if (e instanceof GoogleSignInError) {
    if (e.code === 'play_services') return 'Google Play Hizmetleri gerekli ya da güncel değil.';
    return 'Google ile giriş yapılamadı. Lütfen tekrar deneyin.';
  }
  if (e instanceof ApiError) {
    const detail = (e.body as { detail?: string } | undefined)?.detail;
    if (detail === 'GOOGLE_EMAIL_NOT_VERIFIED') return 'Bu Google hesabının e-postası doğrulanmamış.';
    if (detail === 'GOOGLE_ACCOUNT_MISMATCH') return 'Bu e-posta başka bir Google hesabına bağlı.';
    if (detail === 'GOOGLE_NOT_CONFIGURED') return 'Google ile giriş şu an kullanılamıyor.';
    if (e.status === 401) return 'Hesabın aktif değil ya da Google doğrulaması başarısız.';
  }
  return 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
}

/**
 * "Google ile devam et" — signs in, or signs up (after KVKK consent) with
 * the chosen Google account. Renders nothing when Google Sign-In isn't
 * available in this build (web, Expo Go, or no client ID configured).
 */
export function GoogleSignInButton({ onError }: { onError?: (msg: string) => void }) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = useState(false);

  if (!isGoogleSignInAvailable()) return null;

  const finish = async (res: GoogleLoginResponse) => {
    await setTokens(res.access_token, res.refresh_token);
    setSession(res.user, { accessToken: res.access_token, refreshToken: res.refresh_token });
    // New accounts are offered student (.edu.tr) verification first; Gmail stays fine.
    router.replace(
      (res.is_new_user ? '/settings/student-verification?onboarding=1' : '/tabs/home') as never,
    );
  };

  const onPress = async () => {
    setLoading(true);
    try {
      const idToken = await getGoogleIdToken();
      if (!idToken) return; // user closed the account picker
      try {
        await finish(await loginWithGoogle(idToken));
      } catch (e) {
        const detail = e instanceof ApiError ? (e.body as { detail?: string } | undefined)?.detail : null;
        if (detail !== 'KVKK_CONSENT_REQUIRED') throw e;
        if (!(await askKvkkConsent())) return;
        await finish(await loginWithGoogle(idToken, true));
      }
    } catch (e) {
      const msg = messageFor(e);
      if (onError) onError(msg);
      else Alert.alert('Google ile giriş', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <Text style={[styles.or, { color: colors.textMuted }]}>veya</Text>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>
      <TouchableOpacity
        onPress={onPress}
        disabled={loading}
        style={[styles.btn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Google ile devam et"
        testID="google-sign-in-button"
      >
        {loading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <>
            <Ionicons name="logo-google" size={20} color="#EA4335" />
            <Text style={[styles.btnText, { color: colors.text }]}>Google ile devam et</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  or: { fontSize: fontSize.caption, fontWeight: '600' },
  btn: {
    height: 50,
    borderRadius: radius.button,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  btnText: { fontSize: fontSize.body, fontWeight: '700' },
});
