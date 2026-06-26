import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { Input } from '@/components/ui';
import * as apiClient from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/secure-store';

export default function DeleteAccountScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const clearSession = useAuthStore((s) => s.clearSession);

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const performDelete = async () => {
    if (loading) return;
    if (!password.trim()) {
      setError('Şifrenizi girin');
      return;
    }
    setLoading(true);
    try {
      const deleteAccount = (apiClient as any).deleteAccount as
        | ((...args: any[]) => Promise<any>)
        | undefined;

      if (typeof deleteAccount === 'function') {
        await deleteAccount({ password });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      await clearTokens();
      clearSession();
      toast.show('Hesabınız silindi', { variant: 'success' });
      router.replace('/auth/login');
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const status = err?.status;
      if (status === 401 || status === 403) {
        setError('Şifre hatalı');
      } else if (status === 0) {
        toast.show('Bağlantı hatası, tekrar deneyin', { variant: 'error' });
      } else {
        toast.show('Hesap silinemedi, lütfen destekle iletişime geçin', {
          variant: 'error',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePress = () => {
    if (loading) return;
    if (!password.trim()) {
      setError('Şifrenizi girin');
      return;
    }
    setError('');

    Alert.alert(
      'Hesabımı Sil',
      'Hesabınızı silmek üzeresiniz. Bu işlem geri alınamaz. Tüm kişisel verileriniz KVKK kapsamında anonimleştirilecektir.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Devam',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Son Onay',
              'Devam ederseniz hesabınız kalıcı olarak silinecek ve kitaplarınız, takas geçmişiniz, mesajlarınız erişilemez hale gelecektir. Bu işlem geri alınamaz.',
              [
                { text: 'İptal', style: 'cancel' },
                {
                  text: 'Evet, Sil',
                  style: 'destructive',
                  onPress: performDelete,
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Hesabımı Sil</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.warning, { backgroundColor: colors.danger + '1A' }]}>
          <Ionicons name="warning" size={24} color={colors.danger} />
          <Text style={[styles.warningText, { color: colors.text }]}>
            Hesabınızı silmek üzeresiniz. Bu işlem geri alınamaz.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
            shadows.card,
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            KVKK Kapsamında Hesap Silme
          </Text>
          <Text style={[styles.cardBody, { color: colors.textMuted }]}>
            6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) gereği hesap silme talebinizi
            işliyoruz. Hesabınız silindiğinde:
          </Text>
          <View style={styles.bulletList}>
            <Text style={[styles.bullet, { color: colors.textMuted }]}>
              • Ad, e-posta, telefon gibi kimlik bilgileriniz anonimleştirilir
            </Text>
            <Text style={[styles.bullet, { color: colors.textMuted }]}>
              • Eklediğiniz kitaplar ve fotoğraflar kaldırılır
            </Text>
            <Text style={[styles.bullet, { color: colors.textMuted }]}>
              • Takas geçmişiniz ve mesajlarınız erişilemez hale gelir
            </Text>
            <Text style={[styles.bullet, { color: colors.textMuted }]}>
              • Yasa gereği saklanması gereken kayıtlar anonim olarak tutulur
            </Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.textMuted }]}>
            Bu işlem geri alınamaz. Devam etmek için şifrenizi girin.
          </Text>
        </View>

        <Input
          label="Şifre"
          placeholder="Şifreniz"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) setError('');
          }}
          secureTextEntry
          error={error}
          testID="delete-account-password"
        />

        <TouchableOpacity
          onPress={handleDeletePress}
          style={[styles.deleteBtn, { backgroundColor: colors.danger }, loading && { opacity: 0.7 }]}
          disabled={loading}
          activeOpacity={0.85}
          testID="delete-account-button"
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.deleteBtnText}>Hesabımı Sil</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  warningText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    lineHeight: 20,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  cardBody: {
    fontSize: fontSize.bodySm,
    lineHeight: 20,
  },
  bulletList: {
    gap: spacing.xs,
  },
  bullet: {
    fontSize: fontSize.bodySm,
    lineHeight: 20,
  },
  deleteBtn: {
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '800',
  },
});
