type AnalyticsEvent =
  | 'app_open' | 'book_viewed' | 'book_listed' | 'exchange_requested'
  | 'exchange_accepted' | 'exchange_rejected' | 'meetup_proposed'
  | 'meetup_confirmed' | 'chat_sent' | 'user_blocked' | 'search_performed';

export function track(event: AnalyticsEvent, properties?: Record<string, any>): void {
  if (__DEV__) {
    console.log(`[analytics] ${event}`, properties ?? {});
  }
  // In production: send to backend POST /api/v1/analytics
  // For now, just log in dev. Backend endpoint doesn't exist yet.
}

export function useAnalytics() {
  return { track };
}
