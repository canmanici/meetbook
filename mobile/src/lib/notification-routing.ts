/**
 * Where a notification leads — shared by the in-app notification list and
 * push taps so both open the same screen for the same event.
 *
 * Backend types (backend/app/modules/notifications/service.py PREFERENCE_KEY):
 *   exchange_request, chat_system, location_started, loan_due_3d/1d,
 *   loan_overdue → exchange detail
 *   new_message, missed_call → chat (chats are routed by EXCHANGE id)
 *   club_invite, club_shuffled, club_message → club chat
 *   wishlist_match, geofence_match → book
 *   book_twin → user profile, year_in_review → year-in-review
 *   report_resolved, admin_broadcast → no target (informational)
 */
type Payload = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function hrefForNotification(type: string, payload: Payload | null | undefined): string | null {
  const p = payload ?? {};
  const exchangeId = str(p.exchange_id);
  switch (type) {
    case 'new_message':
    case 'missed_call':
    case 'incoming_call':
      return exchangeId ? `/chat/${exchangeId}` : null;
    case 'club_invite':
    case 'club_shuffled':
    case 'club_message': {
      const clubId = str(p.club_id);
      return clubId ? `/chat/club/${clubId}` : null;
    }
    case 'wishlist_match':
    case 'geofence_match': {
      const bookId = str(p.book_id);
      return bookId ? `/book/${bookId}` : null;
    }
    case 'book_twin': {
      const twinId = str(p.twin_user_id);
      return twinId ? `/user/${twinId}` : null;
    }
    case 'year_in_review':
      return '/year-in-review';
    case 'report_resolved':
    case 'admin_broadcast':
      return null;
    default:
      // exchange_request, chat_system, location_started, loan_* and any
      // future exchange-scoped type.
      return exchangeId ? `/exchange/${exchangeId}` : null;
  }
}
