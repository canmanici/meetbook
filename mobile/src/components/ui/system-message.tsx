import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from './tokens';
import type { MessageView } from '@/lib/api/chat';

const SYSTEM_ICONS: Record<string, { icon: string; color: string }> = {
  exchange_accepted: { icon: 'checkmark-circle', color: '#2FA36B' },
  exchange_rejected: { icon: 'close-circle', color: '#E5645A' },
  exchange_completed: { icon: 'trophy', color: '#E8A13A' },
  exchange_cancelled: { icon: 'ban', color: '#E5645A' },
  meetup_proposed: { icon: 'location', color: '#5B9BD5' },
  meetup_accepted: { icon: 'checkmark-circle', color: '#2FA36B' },
  meetup_rejected: { icon: 'close-circle', color: '#E5645A' },
  book_returned: { icon: 'book', color: '#11806B' },
  default: { icon: 'information-circle', color: '#8A8378' },
};

const SYSTEM_LABELS: Record<string, string> = {
  exchange_accepted: 'Takas kabul edildi',
  exchange_rejected: 'Takas reddedildi',
  exchange_completed: 'Takas tamamlandı',
  exchange_cancelled: 'Takas iptal edildi',
  meetup_proposed: 'Buluşma önerildi',
  meetup_accepted: 'Buluşma kabul edildi',
  meetup_rejected: 'Buluşma reddedildi',
  book_returned: 'Kitap iade edildi',
};

interface SystemMessageProps {
  message: MessageView;
}

export const SystemMessage: React.FC<SystemMessageProps> = ({ message }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

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
