import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing, fontSize, radius, shadows } from './tokens';
import type { MessageView, MessageDeliveryInfo } from '@/lib/api/chat';

interface MessageInfoSheetProps {
  visible: boolean;
  message: MessageView;
  deliveryInfo: MessageDeliveryInfo | null;
  onClose: () => void;
  onStar: () => void;
  onPin: () => void;
  onDelete: () => void;
  onForward: () => void;
}

export const MessageInfoSheet: React.FC<MessageInfoSheetProps> = ({
  visible,
  message,
  deliveryInfo,
  onClose,
  onStar,
  onPin,
  onDelete,
  onForward,
}) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.surface, paddingBottom: Math.max(20, insets.bottom), ...shadows.sheet }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>Mesaj Bilgisi</Text>

          {/* Delivery info */}
          {deliveryInfo && (
            <View style={[styles.deliverySection, { backgroundColor: colors.surfaceAlt }]}>
              <View style={styles.deliveryRow}>
                <Ionicons name="checkmark-outline" size={16} color={colors.primary} />
                <Text style={[styles.deliveryLabel, { color: colors.textMuted }]}>Gönderildi</Text>
                <Text style={[styles.deliveryValue, { color: colors.text }]}>
                  {formatTime(deliveryInfo.sent_at)}
                </Text>
              </View>
              {deliveryInfo.read_at && (
                <View style={styles.deliveryRow}>
                  <Ionicons name="checkmark-done-outline" size={16} color={colors.primary} />
                  <Text style={[styles.deliveryLabel, { color: colors.textMuted }]}>Okundu</Text>
                  <Text style={[styles.deliveryValue, { color: colors.text }]}>
                    {formatTime(deliveryInfo.read_at)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.actionItem, { backgroundColor: colors.surfaceAlt }]} onPress={onStar}>
              <Ionicons
                name={message.starred_at ? 'star' : 'star-outline'}
                size={20}
                color={message.starred_at ? '#E8A13A' : colors.text}
              />
              <Text style={[styles.actionText, { color: colors.text }]}>
                {message.starred_at ? 'Yıldızı Kaldır' : 'Yıldızla'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionItem, { backgroundColor: colors.surfaceAlt }]} onPress={onPin}>
              <Ionicons
                name={message.pinned_at ? 'pin' : 'pin-outline'}
                size={20}
                color={message.pinned_at ? colors.primary : colors.text}
              />
              <Text style={[styles.actionText, { color: colors.text }]}>
                {message.pinned_at ? 'Sabitlemeyi Kaldır' : 'Sabitle'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionItem, { backgroundColor: colors.surfaceAlt }]} onPress={onForward}>
              <Ionicons name="arrow-forward-outline" size={20} color={colors.text} />
              <Text style={[styles.actionText, { color: colors.text }]}>İlet</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionItem, { backgroundColor: colors.danger + '10' }]}
              onPress={onDelete}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>Sil</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  container: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  deliverySection: {
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deliveryLabel: {
    fontSize: fontSize.bodySm,
    flex: 1,
  },
  deliveryValue: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
  },
  actions: {
    gap: spacing.sm,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.card,
    gap: spacing.md,
  },
  actionText: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
});
