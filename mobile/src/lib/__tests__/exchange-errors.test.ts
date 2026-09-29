jest.mock('@/lib/api/client', () => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super('error');
      this.status = status;
      this.body = body;
    }
  }
  return { ApiError };
});

import { exchangeRequestError, lendError } from '../exchange-errors';
import { isEduEmail } from '../api/credits';

const { ApiError } = jest.requireMock('@/lib/api/client');

describe('exchangeRequestError', () => {
  it('does not treat every 409 as a duplicate request', () => {
    const credit = exchangeRequestError(new ApiError(409, { detail: 'INSUFFICIENT_CREDITS' }));
    expect(credit.message).toMatch(/kredin yetmiyor/);
    expect(credit.creditAction).toBe(true);

    const dup = exchangeRequestError(new ApiError(409, { detail: 'DUPLICATE_REQUEST' }));
    expect(dup.message).toBe('Bu kitap için zaten bir talebin var.');
    expect(dup.creditAction).toBe(false);
  });

  it('maps deposit and ban errors', () => {
    expect(
      exchangeRequestError(new ApiError(409, { detail: 'INSUFFICIENT_CREDITS_FOR_DEPOSIT' })).creditAction,
    ).toBe(true);
    expect(exchangeRequestError(new ApiError(403, { detail: 'BORROW_BANNED' })).message).toMatch(
      /ödünç alma hakkın kapatıldı/,
    );
  });

  it('falls back for unknown and non-API errors', () => {
    expect(exchangeRequestError(new Error('boom')).message).toMatch(/Talep gönderilemedi/);
    expect(exchangeRequestError(new ApiError(500, {})).creditAction).toBe(false);
  });
});

describe('lendError', () => {
  it('warns the owner not to hand the book over when the deposit is missing', () => {
    expect(lendError(new ApiError(409, { detail: 'INSUFFICIENT_CREDITS_FOR_DEPOSIT' }))).toMatch(
      /Kitabı teslim etme/,
    );
  });
});

describe('isEduEmail', () => {
  it('accepts only <school>.edu.tr addresses', () => {
    expect(isEduEmail('a@ogr.itu.edu.tr')).toBe(true);
    expect(isEduEmail(' A@Boun.Edu.Tr ')).toBe(true);
    expect(isEduEmail('a@edu.tr')).toBe(false);
    expect(isEduEmail('a@gmail.com')).toBe(false);
    expect(isEduEmail('@itu.edu.tr')).toBe(false);
    expect(isEduEmail('a@itu.edu.tr.evil.com')).toBe(false);
  });
});
