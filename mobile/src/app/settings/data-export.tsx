import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import * as apiClient from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';

export default function DataExportScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const requestDataExport = (apiClient as any).requestDataExport as
        | ((...args: any[]) => Promise<any>)
        | undefined;

      if (typeof requestDataExport === 'function') {
        await requestDataExport();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast.show('İstek alındı, 48 saat içinde hazırlanacak', { variant: 'success' });
        return;
      }

      const [meData, booksData, sentExchanges, receivedExchanges] = await Promise.all([
        apiClient.getMe(),
        apiClient.listMyBooks({ limit: 50 }),
        apiClient.listExchanges({ role: 'sent', limit: 50 }).catch(() => ({ items: [] })),
        apiClient.listExchanges({ role: 'received', limit: 50 }).catch(() => ({ items: [] })),
      ]);

      const data = {
        profile: meData,
        books: booksData,
        exchanges: {
          sent: sentExchanges,
          received: receivedExchanges,
        },
        exportedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(data, null, 2);

      const filename = `meetbook-export-${Date.now()}.json`;
      const file = new FileSystem.File(FileSystem.Paths.document, filename);
      file.write(json);

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        toast.show('Paylaşım kullanılamıyor, veriler dosyaya kaydedildi', { variant: 'info' });
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Verilerimi İndir',
        UTI: 'public.json',
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show('İstek alındı, 48 saat içinde hazırlanacak', { variant: 'success' });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show('Veriler dışa aktarılamadı', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Verilerimi İndir</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.explainer, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="download" size={22} color={colors.primary} />
          <Text style={[styles.explainerText, { color: colors.text }]}>
            KVKK kapsamında kişisel verilerinizi dışa aktarabilirsiniz. İstek alındıktan sonra 48 saat
            içinde hazırlanacaktır.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Profil Bilgileri</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>Ad, e-posta, telefon</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
          <View style={styles.row}>
            <Ionicons name="book-outline" size={28} color={colors.primary} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Kitaplarım</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>Eklediğiniz kitaplar</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.textMuted, opacity: 0.1 }]} />
          <View style={styles.row}>
            <Ionicons name="swap-horizontal" size={28} color={colors.primary} />
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Takaslar</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>Gönderilen ve alınan istekler</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleExport}
          style={[styles.exportBtn, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
          disabled={loading}
          activeOpacity={0.85}
          testID="data-export-button"
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.exportBtnText}>Verilerimi İndir</Text>
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
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  explainerText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    lineHeight: 20,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowInfo: {
    flex: 1,
  },
  rowLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  rowSub: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.xl + spacing.sm,
  },
  exportBtn: {
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  exportBtnText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '800',
  },
});
