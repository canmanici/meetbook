import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
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
  return { ApiError };
});
jest.mock('@/lib/api/teachers', () => ({
  getTeacherStatus: jest.fn(),
  applyAsTeacher: jest.fn(),
  listStudentCodes: jest.fn(),
  issueStudentCodes: jest.fn(),
  revokeStudentCode: jest.fn(),
}));

import TeacherScreen from '../teacher';

const fresh = { is_teacher: false, institution: null, application: null, can_apply: true, reapply_after: null };

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeacherScreen />
    </QueryClientProvider>,
  );
}

describe('TeacherScreen', () => {
  const api = require('@/lib/api/teachers');
  const { ApiError } = require('@/lib/api/client');

  beforeEach(() => {
    api.getTeacherStatus.mockReset();
    api.applyAsTeacher.mockReset();
  });

  it('requires a way to verify the claim before submitting', async () => {
    api.getTeacherStatus.mockResolvedValue(fresh);
    const { findByTestId, getByTestId, findByText } = renderScreen();
    fireEvent.changeText(await findByTestId('teacher-institution'), 'İTÜ');
    fireEvent.press(getByTestId('teacher-submit'));
    expect(await findByText(/iş e-postanı veya kadro sayfanı ekle/)).toBeTruthy();
    expect(api.applyAsTeacher).not.toHaveBeenCalled();
  });

  it('submits an application with a non-edu email and shows it as pending', async () => {
    api.getTeacherStatus.mockResolvedValue(fresh);
    api.applyAsTeacher.mockResolvedValue({
      ...fresh,
      can_apply: false,
      application: {
        id: 'a1', institution: 'İTÜ', department: null, work_email: 'hoca@gmail.com',
        profile_url: null, note: null, status: 'pending', review_note: null,
        reviewed_at: null, created_at: '2026-09-29T10:00:00Z',
      },
    });
    const { findByTestId, getByTestId } = renderScreen();
    fireEvent.changeText(await findByTestId('teacher-institution'), 'İTÜ');
    fireEvent.changeText(getByTestId('teacher-email'), 'hoca@gmail.com');
    fireEvent.press(getByTestId('teacher-submit'));
    await waitFor(() =>
      expect(api.applyAsTeacher).toHaveBeenCalledWith(
        expect.objectContaining({ institution: 'İTÜ', work_email: 'hoca@gmail.com' }),
      ),
    );
    expect(await findByTestId('teacher-status-pending')).toBeTruthy();
  });

  it('shows the rejection reason and hides the form during the cooldown', async () => {
    api.getTeacherStatus.mockResolvedValue({
      ...fresh,
      can_apply: false,
      reapply_after: '2026-10-29T10:00:00Z',
      application: {
        id: 'a1', institution: 'İTÜ', department: null, work_email: null,
        profile_url: 'https://x', note: null, status: 'rejected', review_note: 'Kadroda bulunamadı',
        reviewed_at: '2026-09-29T10:00:00Z', created_at: '2026-09-28T10:00:00Z',
      },
    });
    const { findByText, queryByTestId } = renderScreen();
    expect(await findByText('Kadroda bulunamadı')).toBeTruthy();
    expect(queryByTestId('teacher-submit')).toBeNull();
  });

  it('explains a revoked badge on apply attempt', async () => {
    api.getTeacherStatus.mockResolvedValue(fresh);
    api.applyAsTeacher.mockRejectedValue(new ApiError(409, { detail: 'TEACHER_REVOKED' }));
    const { findByTestId, getByTestId, findByText } = renderScreen();
    fireEvent.changeText(await findByTestId('teacher-institution'), 'İTÜ');
    fireEvent.changeText(getByTestId('teacher-url'), 'https://itu.edu.tr/kadro/x');
    fireEvent.press(getByTestId('teacher-submit'));
    expect(await findByText(/Rozetin daha önce kaldırıldığı/)).toBeTruthy();
  });

  it('approved teacher issues student codes and hits the cap cleanly', async () => {
    api.getTeacherStatus.mockResolvedValue({ ...fresh, is_teacher: true, institution: 'İTÜ', can_apply: false });
    const code = {
      id: 'c1', code: 'ABCD-EFGH', created_at: '2026-09-29T10:00:00Z',
      expires_at: '2026-10-13T10:00:00Z', status: 'active', redeemed_at: null,
    };
    api.listStudentCodes.mockResolvedValue({ items: [], active_count: 0, max_active: 30 });
    api.issueStudentCodes
      .mockResolvedValueOnce({ items: [code], active_count: 1, max_active: 30 })
      .mockRejectedValueOnce(new ApiError(409, { detail: 'CODE_LIMIT' }));
    const { findByTestId, getByTestId, findByText, queryByTestId } = renderScreen();

    fireEvent.press(await findByTestId('teacher-codes-issue'));
    expect(await findByTestId('code-ABCD-EFGH')).toBeTruthy();
    expect(getByTestId('teacher-codes-summary').props.children.join('')).toMatch(/^1 \/ 30/);

    fireEvent.press(getByTestId('teacher-codes-issue'));
    expect(await findByText(/En fazla 30 açık kodun olabilir/)).toBeTruthy();
    // Approved: no application form any more.
    expect(queryByTestId('teacher-submit')).toBeNull();
  });
});
