import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, fontSize, radius } from './tokens';
import type { MessageView } from '@/lib/api/chat';

const SYSTEM_ICONS: Record<string, { icon: string; color: string }> = {
  exchange_accepted: { icon: 'checkmark-circle', color: '#2FA36B' },
  exchange_rejected: { icon: 'close-circle', color: '#E5645A' },
  exchange_completion_marked: { icon: 'hourglass', color: '#E8A13A' },
  exchange_completed: { icon: 'trophy', color: '#E8A13A' },
  exchange_cancelled: { icon: 'ban', color: '#E5645A' },
  meetup_proposed: { icon: 'location', color: '#5B9BD5' },
  meetup_accepted: { icon: 'checkmark-circle', color: '#2FA36B' },
  meetup_rejected: { icon: 'close-circle', color: '#E5645A' },
  book_lent: { icon: 'book', color: '#11806B' },
  book_returned: { icon: 'book', color: '#11806B' },
  loan_completed: { icon: 'trophy', color: '#E8A13A' },
  extension_requested: { icon: 'time', color: '#5B9BD5' },
  extension_approved: { icon: 'checkmark-circle', color: '#2FA36B' },
  extension_rejected: { icon: 'close-circle', color: '#E5645A' },
  book_retired: { icon: 'archive', color: '#8A8378' },
  reading_buddy_requested: { icon: 'people', color: '#5B9BD5' },
  reading_buddy_accepted: { icon: 'checkmark-circle', color: '#2FA36B' },
  reading_buddy_declined: { icon: 'close-circle', color: '#E5645A' },
  location_accepted: { icon: 'navigate', color: '#2FA36B' },
  default: { icon: 'information-circle', color: '#8A8378' },
};

const SYSTEM_LABELS: Record<string, string> = {
  exchange_accepted: 'Takas kabul edildi',
  exchange_rejected: 'Takas reddedildi',
  exchange_completion_marked: 'Tamamlandı olarak işaretlendi',
  exchange_completed: 'Takas tamamlandı',
  exchange_cancelled: 'Takas iptal edildi',
  meetup_proposed: 'Buluşma önerildi',
  meetup_accepted: 'Buluşma kabul edildi',
  meetup_rejected: 'Buluşma reddedildi',
  book_lent: 'Kitap teslim edildi',
  book_returned: 'Kitap iade edildi',
  loan_completed: 'Ödünç takası tamamlandı',
  extension_requested: 'Süre uzatımı istendi',
  extension_approved: 'Süre uzatımı onaylandı',
  extension_rejected: 'Süre uzatımı reddedildi',
  book_retired: 'Kitap rafa kaldırıldı',
  reading_buddy_requested: 'Okuma arkadaşlığı teklif edildi',
  reading_buddy_accepted: 'Okuma arkadaşlığı kabul edildi',
  reading_buddy_declined: 'Okuma arkadaşlığı reddedildi',
  location_accepted: 'Canlı konum paylaşımı kabul edildi',
};

interface SystemMessageProps {
  message: MessageView;
}

export const SystemMessage: React.FC<SystemMessageProps> = ({ message }) => {
  const action = message.extra?.action || 'default';
  const config = SYSTEM_ICONS[action] || SYSTEM_ICONS.default;
  const label = message.text || SYSTEM_LABELS[action] || action;

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: config.color + '15' }]}>
        <Ionicons name={config.icon as any} size={14} color={config.color} />
        <Text style={[styles.text, { color: config.color }]}>{label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  text: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
