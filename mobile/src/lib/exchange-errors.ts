/**
 * Human messages for exchange API errors. Keyed on the backend `detail`
 * code — never on the bare status: several different problems share 409.
 */
import { ApiError } from '@/lib/api/client';

export interface ExchangeErrorInfo {
  message: string;
  /** Show a "Kredilerim" shortcut — the fix is earning credits or verifying. */
  creditAction: boolean;
}

export function apiErrorDetail(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== 'object') return undefined;
  const detail = (err.body as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : undefined;
}

const REQUEST_MESSAGES: Record<string, ExchangeErrorInfo> = {
  INSUFFICIENT_CREDITS: {
    message:
      'Bu kitabı almak için kredin yetmiyor. Bir kitap vererek kredi kazanabilir ya da öğrenci e-postanı doğrulayabilirsin.',
    creditAction: true,
  },
  INSUFFICIENT_CREDITS_FOR_DEPOSIT: {
    message:
      'Ödünç almak için depozito kadar kredin olmalı. Depozito borçla ödenemez; önce kitap vererek kredi kazan.',
    creditAction: true,
  },
  BORROW_BANNED: {
    message:
      'İade edilmeyen bir kitap yüzünden ödünç alma hakkın kapatıldı. Takas yapmaya devam edebilirsin.',
    creditAction: false,
  },
  ACTIVE_LOAN_EXISTS: {
    message: 'Zaten ödünçte bir kitabın var. Önce onu iade et.',
    creditAction: false,
  },
  DUPLICATE_REQUEST: { message: 'Bu kitap için zaten bir talebin var.', creditAction: false },
  NEW_ACCOUNT_LIMIT: {
    message: 'Yeni hesaplar için aktif talep limitine ulaştın.',
    creditAction: false,
  },
  BOOK_UNAVAILABLE: { message: 'Bu kitap artık müsait değil.', creditAction: false },
  BOOK_NOT_FOUND: { message: 'Bu kitap artık müsait değil.', creditAction: false },
};

/** Errors from creating an exchange request (book detail, map preview). */
export function exchangeRequestError(err: unknown): ExchangeErrorInfo {
  const detail = apiErrorDetail(err);
  return (
    (detail && REQUEST_MESSAGES[detail]) || {
      message: 'Talep gönderilemedi. Lütfen tekrar deneyin.',
      creditAction: false,
    }
  );
}

/** Errors from the owner marking a loan as handed over. */
export function lendError(err: unknown): string {
  switch (apiErrorDetail(err)) {
    case 'INSUFFICIENT_CREDITS_FOR_DEPOSIT':
      return 'Karşı tarafın depozito için yeterli kredisi yok. Kitabı teslim etme; takası iptal edebilirsin.';
    case 'BORROW_BANNED':
      return 'Bu kullanıcının ödünç alma hakkı kapatılmış. Kitabı teslim etme.';
    case 'ACTIVE_LOAN_EXISTS':
      return 'Bu kullanıcının zaten ödünçte bir kitabı var.';
    default:
      return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }
}
