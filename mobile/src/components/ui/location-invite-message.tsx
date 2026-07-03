import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, shadows } from './tokens';
import type { MessageView } from '@/lib/api/chat';

interface LocationInviteMessageProps {
  message: MessageView;
  isMine: boolean;
  onAccept: (message: MessageView) => Promise<void> | void;
  onDecline: (message: MessageView) => void;
}

// Invites older than this are assumed abandoned — the sender's share session
// would have long since timed out (safety.ts auto-stops 30min after the
// meetup), so an ancient card should stop offering Accept/Decline rather than
// reappearing "actionable" forever every time the chat history reloads.
const INVITE_EXPIRY_MS = 15 * 60 * 1000;

export const LocationInviteMessage: React.FC<LocationInviteMessageProps> = ({
  message,
  isMine,
  onAccept,
  onDecline,
}) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [responded, setResponded] = useState<'accepted' | 'declined' | null>(null);
  const [loading, setLoading] = useState(false);
  const isExpired = Date.now() - new Date(message.created_at).getTime() > INVITE_EXPIRY_MS;

  const handleAccept = async () => {
    setLoading(true);
    try {
      await onAccept(message);
      setResponded('accepted');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = () => {
    setResponded('declined');
    onDecline(message);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderColor: colors.info + '40' },
        shadows.card,
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.info + '20' }]}>
          <Ionicons name="navigate" size={18} color={colors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Nerdeyim Modu</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {isMine
              ? 'Canlı konum paylaşımı teklif ettin'
              : 'Canlı konum paylaşımı teklif etti'}
          </Text>
        </View>
      </View>

      {isMine ? (
        <View style={styles.statusRow}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>Yanıt bekleniyor…</Text>
        </View>
      ) : responded === 'accepted' ? (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.success }]}>Kabul ettin, konumun paylaşılıyor</Text>
        </View>
      ) : responded === 'declined' ? (
        <View style={styles.statusRow}>
          <Ionicons name="close-circle" size={14} color={colors.textMuted} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>Reddedildi</Text>
        </View>
      ) : isExpired ? (
        <View style={styles.statusRow}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>Davetin süresi doldu</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.info }]}
            onPress={handleAccept}
            disabled={loading}
            testID="location-invite-accept"
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Kabul Et</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.surfaceAlt }]}
            onPress={handleDecline}
            disabled={loading}
            testID="location-invite-decline"
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
            <Text style={[styles.actionButtonText, { color: colors.textMuted }]}>Reddet</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.sm,
    maxWidth: 280,
    gap: spacing.xs,
    minWidth: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: fontSize.bodySm, fontWeight: '700' },
  subtitle: { fontSize: fontSize.caption, marginTop: 1 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  statusText: { fontSize: fontSize.caption, fontWeight: '500' },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: 2,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: radius.input,
  },
  actionButtonText: { fontSize: fontSize.caption, fontWeight: '700', color: '#ffffff' },
});
