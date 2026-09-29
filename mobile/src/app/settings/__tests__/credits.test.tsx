import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/lib/api/client', () => ({
  getMe: jest.fn().mockResolvedValue({ edu_email: 'ali@ogr.itu.edu.tr' }),
}));
jest.mock('@/lib/api/credits', () => ({
  ...jest.requireActual('@/lib/api/credits'),
  getWallet: jest.fn(),
}));

import CreditsScreen from '../credits';

const baseWallet = {
  balance: 1,
  reserved: 0,
  available: 1,
  floor: 0,
  trade_cost: 1,
  loan_deposit: 2,
  can_borrow: false,
  borrow_banned: false,
  edu_verified: false,
  transactions: [],
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreditsScreen />
    </QueryClientProvider>,
  );
}

describe('CreditsScreen', () => {
  const { getWallet } = require('@/lib/api/credits');
  const { router } = require('expo-router');

  beforeEach(() => {
    getWallet.mockReset();
    router.push.mockClear();
  });

  it('shows the balance and offers student verification when not verified', async () => {
    getWallet.mockResolvedValue(baseWallet);
    const { findByTestId, getByText } = renderScreen();
    expect((await findByTestId('credits-balance')).props.children).toBe(1);
    expect(getByText(/Ödünç almak için 2 kullanılabilir kredi gerekir/)).toBeTruthy();
    fireEvent.press(await findByTestId('credits-verify-cta'));
    expect(router.push).toHaveBeenCalledWith('/settings/student-verification');
  });

  it('shows debt, the student badge and labelled history', async () => {
    getWallet.mockResolvedValue({
      ...baseWallet,
      balance: -2,
      available: -2,
      floor: -2,
      edu_verified: true,
      transactions: [
        { id: 't2', amount: -1, kind: 'trade_received', exchange_id: 'e1', balance_after: -2, created_at: '2026-09-29T10:00:00Z' },
        { id: 't1', amount: 1, kind: 'starter', exchange_id: null, balance_after: 1, created_at: '2026-09-28T10:00:00Z' },
      ],
    });
    const { findByText, findByTestId, queryByTestId } = renderScreen();
    expect(await findByText('2 kredi borcun var')).toBeTruthy();
    expect(await findByText(/Öğrenci doğrulandı · ogr.itu.edu.tr/)).toBeTruthy();
    expect(queryByTestId('credits-verify-cta')).toBeNull();
    expect(await findByTestId('credits-tx-trade_received')).toBeTruthy();
    expect(await findByText('Öğrenci hoş geldin kredisi')).toBeTruthy();
    expect(await findByText('+1')).toBeTruthy();
  });

  it('tells a banned borrower why they cannot borrow', async () => {
    getWallet.mockResolvedValue({ ...baseWallet, balance: 5, available: 5, borrow_banned: true });
    const { findByTestId } = renderScreen();
    expect(await findByTestId('credits-borrow-banned')).toBeTruthy();
  });

  it('shows a retry when the wallet fails to load', async () => {
    getWallet.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(baseWallet);
    const { findByTestId } = renderScreen();
    fireEvent.press(await findByTestId('credits-retry'));
    await waitFor(() => expect(getWallet).toHaveBeenCalledTimes(2));
  });
});
