import type { BadgeVariant } from '@/components/ui';
import type { ExchangeStatus } from '@/lib/api/client';

export const EXCHANGE_STATUS_LABELS: Record<ExchangeStatus, string> = {
  pending: 'Beklemede',
  accepted: 'Kabul Edildi',
  rejected: 'Reddedildi',
  cancelled: 'İptal Edildi',
  meetup_proposed: 'Buluşma Önerildi',
  meetup_confirmed: 'Buluşma Onaylandı',
  completion_pending: 'Onay Bekleniyor',
  completed: 'Tamamlandı',
  expired: 'Süresi Doldu',
  lent: 'Ödünçte',
  return_pending: 'İade Onayı Bekliyor',
  overdue: 'Gecikmiş',
};

export const EXCHANGE_STATUS_VARIANTS: Record<ExchangeStatus, BadgeVariant> = {
  pending: 'info',
  accepted: 'primary',
  rejected: 'danger',
  cancelled: 'danger',
  meetup_proposed: 'info',
  meetup_confirmed: 'primary',
  completion_pending: 'warning',
  completed: 'success',
  expired: 'danger',
  lent: 'primary',
  return_pending: 'warning',
  overdue: 'danger',
};
