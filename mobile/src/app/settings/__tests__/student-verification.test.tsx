import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
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
  return { ApiError, getMe: jest.fn().mockResolvedValue({ edu_verified: false }) };
});
jest.mock('@/lib/api/teachers', () => ({ redeemStudentCode: jest.fn() }));

import StudentVerificationScreen from '../student-verification';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StudentVerificationScreen />
    </QueryClientProvider>,
  );
}

describe('StudentVerificationScreen (teacher code)', () => {
  const teachers = require('@/lib/api/teachers');
  const { ApiError } = require('@/lib/api/client');
  const client = require('@/lib/api/client');
  const { router, useLocalSearchParams } = require('expo-router');

  beforeEach(() => {
    teachers.redeemStudentCode.mockReset();
    router.replace.mockClear();
    router.push.mockClear();
    useLocalSearchParams.mockReturnValue({});
    client.getMe.mockResolvedValue({ edu_verified: false });
  });

  it('formats the code while typing and verifies it', async () => {
    teachers.redeemStudentCode.mockResolvedValue(undefined);
    const { getByTestId, findByText } = renderScreen();
    const input = getByTestId('student-code-input');

    fireEvent.changeText(input, 'abcd efg');
    expect(getByTestId('student-code-verify').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(input, 'abcd efgh');
    fireEvent.press(getByTestId('student-code-verify'));

    await waitFor(() => expect(teachers.redeemStudentCode).toHaveBeenCalledWith('ABCD-EFGH'));
    expect(await findByText('Öğrenci hesabın hazır!')).toBeTruthy();
  });

  it('shows one clear message for a bad code', async () => {
    teachers.redeemStudentCode.mockRejectedValue(new ApiError(400, { detail: 'INVALID_STUDENT_CODE' }));
    const { getByTestId, findByText } = renderScreen();
    fireEvent.changeText(getByTestId('student-code-input'), 'ZZZZZZZZ');
    fireEvent.press(getByTestId('student-code-verify'));
    expect(await findByText(/Kod geçersiz, kullanılmış veya süresi dolmuş/)).toBeTruthy();
  });

  it('during sign-up it can be skipped', async () => {
    useLocalSearchParams.mockReturnValue({ onboarding: '1' });
    const { findByTestId, queryByTestId } = renderScreen();
    expect(queryByTestId('back-button')).toBeNull();
    fireEvent.press(await findByTestId('student-skip'));
    expect(router.replace).toHaveBeenCalledWith('/personality-books');
  });

  it('during sign-up it is skipped automatically for an already verified student', async () => {
    useLocalSearchParams.mockReturnValue({ onboarding: '1' });
    client.getMe.mockResolvedValue({ edu_verified: true });
    renderScreen();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/personality-books'));
  });

  it('links teachers to the teacher application', async () => {
    const { findByTestId } = renderScreen();
    fireEvent.press(await findByTestId('student-teacher-link'));
    expect(router.push).toHaveBeenCalledWith('/settings/teacher');
  });
});
