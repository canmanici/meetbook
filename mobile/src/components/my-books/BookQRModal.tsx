import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  useColorScheme,
  Alert,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { QRCodeView, bookDeepLink } from '@/lib/qr';
import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';

interface BookQRModalProps {
  visible: boolean;
  onClose: () => void;
  bookId: string;
  title: string;
  author: string | null;
  coverUrl?: string;
}

export function BookQRModal({
  visible,
  onClose,
  bookId,
  title,
  author,
  coverUrl,
}: BookQRModalProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const deepLink = bookDeepLink(bookId);

  const handleShare = async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(deepLink, {
          dialogTitle: `${title} — Meetbook`,
        });
      } else {
        Alert.alert('Paylaşım', `Bağlantı: ${deepLink}`);
      }
    } catch {
      // User cancelled share
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]}
            onPress={onClose}
            accessibilityLabel="Kapat"
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, { backgroundColor: colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' }]}>
              <Ionicons name="book-outline" size={28} color={colors.textMuted} />
            </View>
          )}

          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {title}
          </Text>
          {author ? (
            <Text style={[styles.author, { color: colors.textMuted }]}>
              {author}
            </Text>
          ) : null}

          <View style={[styles.qrWrap, { borderColor: colors.primarySoft }]}>
            <QRCodeView value={deepLink} size={180} />
          </View>

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Bu kodu tarayın kitabı görüntüleyin
          </Text>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, { backgroundColor: colors.surfaceAlt }]}
              onPress={handleShare}
              activeOpacity={0.7}
              accessibilityLabel="Paylaş"
            >
              <Ionicons name="share-outline" size={16} color={colors.text} />
              <Text style={[styles.btnText, { color: colors.text }]}>Paylaş</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary }]}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Kapat"
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={[styles.btnText, { color: '#fff' }]}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(21,20,15,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 280,
    borderRadius: radius.sheet,
    padding: spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 10,
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  cover: {
    width: 60,
    height: 85,
    borderRadius: radius.field,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 2,
  },
  author: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  qrWrap: {
    borderWidth: 3,
    borderRadius: radius.card,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 16,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 3,
    borderRadius: radius.button,
  },
  btnPrimary: {},
  btnSecondary: {},
  btnText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});
