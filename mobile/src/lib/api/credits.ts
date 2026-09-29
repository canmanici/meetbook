/**
 * Book credits (/api/v1/credits) and university (.edu.tr) verification.
 * Give a book → +1, take a book → -1, borrowing locks a deposit.
 */
import { authedRequest } from '@/lib/api/client';

import type { components } from './schema';

export type Wallet = components['schemas']['WalletResponse'];
export type CreditTransaction = components['schemas']['CreditTransactionView'];
export type CreditKind = CreditTransaction['kind'];

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  starter: 'Öğrenci hoş geldin kredisi',
  trade_given: 'Kitap verdin',
  trade_received: 'Kitap aldın',
  loan_deposit_hold: 'Ödünç depozitosu ayrıldı',
  loan_deposit_release: 'Depozito iade edildi',
  loan_deposit_award: 'İade edilmeyen kitap için depozito',
};

/** Mirrors the backend rule: something@<school>.edu.tr */
export function isEduEmail(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at <= 0) return false;
  const domain = email.trim().toLowerCase().slice(at + 1);
  return domain.endsWith('.edu.tr') && domain !== 'edu.tr';
}

export function getWallet(): Promise<Wallet> {
  return authedRequest<Wallet>('/credits/me', 'GET', undefined);
}

export function requestEduVerification(eduEmail: string): Promise<{ message: string }> {
  return authedRequest('/auth/edu-email', 'POST', { edu_email: eduEmail });
}

export function verifyEduEmail(code: string): Promise<{ message: string }> {
  return authedRequest('/auth/edu-email/verify', 'POST', { code });
}
