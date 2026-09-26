/**
 * KVKK — "Verilerimin silinmesini iste".
 *
 * Unlike Hesabımı Sil (immediate account deletion), this files a data-erasure
 * request with the data controller: it lands in the admin KVKK queue and the
 * user's data is erased from all servers within 30 business days, as stated in
 * the Aydınlatma Metni. One open request at a time — a repeat tap shows it.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius, shadows, Input } from '@/components/ui';
import * as apiClient from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';

const STATUS_LABEL: Record<string, string> = {
  open: 'Alındı — işleme alınacak',
  in_progress: 'İşleniyor',
  answered: 'Tamamlandı',
  rejected: 'Reddedildi',
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function DataDeletionScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const { data: current, isLoading } = useQuery({
    queryKey: ['deletion-request'],
    queryFn: apiClient.getDeletionRequest,
  });
  const isOpen = !!current && !current.closed_at && !['answered', 'rejected'].includes(current.status);

  const send = async () => {
    setSending(true);
    try {
      const res = await apiClient.requestDataDeletion(note.trim() || undefined);
      queryClient.setQueryData(['deletion-request'], res);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(
        res.already_open ? 'Zaten açık bir talebiniz var' : 'Silme talebiniz alındı',
        { variant: 'success' },
      );
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(
        err?.status === 0 ? 'Bağlantı hatası, tekrar deneyin' : 'Talep gönderilemedi, tekrar deneyin',
        { variant: 'error' },
      );
    } finally {
      setSending(false);
    }
  };

  const confirm = () => {
    if (sending) return;
    Alert.alert(
      'Verilerimin silinmesini iste',
      'Talebiniz kayda alınacak ve kişisel verileriniz en geç 30 iş günü içinde tüm sunucularımızdan silinecek. Silme tamamlandığında hesabınızı kullanamazsınız.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Talebi gönder', style: 'destructive', onPress: send },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Verilerimin Silinmesi</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>KVKK kapsamında silme talebi</Text>
          <Text style={[styles.cardBody, { color: colors.textMuted }]}>
            Güvenlik amacıyla ve cihazınızdaki hataları daha hızlı düzeltebilmek için aşağıdaki verileri
            işliyoruz. Talebiniz üzerine bunlar, hesap ve içerik verilerinizle birlikte
            <Text style={{ fontWeight: '700', color: colors.text }}> en geç 30 iş günü içinde tüm sunucularımızdan silinir.</Text>
          </Text>
          <View style={styles.bulletList}>
            {[
              'Hesap bilgileriniz, kitaplarınız, fotoğraflarınız ve mesajlarınız',
              'IP adresiniz, operatörünüz ve yaklaşık konumunuz',
              'Cihaz bilgileriniz (marka, model, işletim sistemi, uygulama sürümü)',
              'Giriş geçmişiniz, eylem kayıtlarınız ve hata raporlarınız',
            ].map((t) => (
              <Text key={t} style={[styles.bullet, { color: colors.textMuted }]}>• {t}</Text>
            ))}
          </View>
          <TouchableOpacity onPress={() => Linking.openURL('https://canmanici.com/meetbook/legal/kvkk-aydinlatma-metni')}>
            <Text style={[styles.link, { color: colors.primary }]}>KVKK Aydınlatma Metni</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : isOpen && current ? (
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}
            testID="deletion-request-status"
          >
            <View style={styles.statusRow}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Talebiniz alındı</Text>
            </View>
            <Text style={[styles.cardBody, { color: colors.textMuted }]}>
              Referans: <Text style={{ fontWeight: '700', color: colors.text }}>{current.reference}</Text>
            </Text>
            <Text style={[styles.cardBody, { color: colors.textMuted }]}>
              Durum: {STATUS_LABEL[current.status] ?? current.status}
            </Text>
            <Text style={[styles.cardBody, { color: colors.textMuted }]}>
              Gönderildi: {formatDay(current.created_at)} · En geç: {formatDay(current.due_at)}
            </Text>
          </View>
        ) : (
          <>
            {current && (
              <Text style={[styles.cardBody, { color: colors.textMuted }]}>
                Önceki talebiniz ({current.reference}): {STATUS_LABEL[current.status] ?? current.status}
              </Text>
            )}
            <Input
              label="Not (isteğe bağlı)"
              placeholder="Eklemek istediğiniz bir şey varsa"
              value={note}
              onChangeText={setNote}
              testID="deletion-note"
            />
            <TouchableOpacity
              onPress={confirm}
              style={[styles.sendBtn, { backgroundColor: colors.danger }, sending && { opacity: 0.7 }]}
              disabled={sending}
              activeOpacity={0.85}
              testID="deletion-request-button"
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>Silme talebi gönder</Text>
              )}
            </TouchableOpacity>
          </>
        )}
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
  headerBorder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1 },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md, borderRadius: radius.card, borderWidth: 1, gap: spacing.sm },
  cardTitle: { fontSize: fontSize.body, fontWeight: '700' },
  cardBody: { fontSize: fontSize.bodySm, lineHeight: 20 },
  bulletList: { gap: spacing.xs },
  bullet: { fontSize: fontSize.bodySm, lineHeight: 20 },
  link: { fontSize: fontSize.bodySm, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sendBtn: { borderRadius: radius.button, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  sendBtnText: { color: '#fff', fontSize: fontSize.body, fontWeight: '800' },
});
