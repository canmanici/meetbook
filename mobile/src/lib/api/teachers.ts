/**
 * Teacher verification (/api/v1/teachers). A teacher applies, a human admin
 * decides. Approved teachers get a badge — nothing else.
 */
import { authedRequest } from '@/lib/api/client';

import type { components } from './schema';

export type TeacherStatus = components['schemas']['TeacherStatusResponse'];
export type TeacherApplyBody = components['schemas']['TeacherApplyRequest'];

export function getTeacherStatus(): Promise<TeacherStatus> {
  return authedRequest<TeacherStatus>('/teachers/me', 'GET', undefined);
}

export function applyAsTeacher(body: TeacherApplyBody): Promise<TeacherStatus> {
  return authedRequest<TeacherStatus>('/teachers/apply', 'POST', body);
}

// -- Student codes: an approved teacher verifies students in class ----------

export type StudentCodeList = components['schemas']['StudentCodeListResponse'];
export type StudentCode = components['schemas']['StudentCodeView'];

export function listStudentCodes(): Promise<StudentCodeList> {
  return authedRequest<StudentCodeList>('/teachers/codes', 'GET', undefined);
}

export function issueStudentCodes(count: number, expiresInDays: number): Promise<StudentCodeList> {
  return authedRequest<StudentCodeList>('/teachers/codes', 'POST', {
    count,
    expires_in_days: expiresInDays,
  });
}

/** Applicant: the activation code an admin e-mailed to the work address. */
export function activateTeacher(code: string): Promise<TeacherStatus> {
  return authedRequest<TeacherStatus>('/teachers/activate', 'POST', { code });
}

export function revokeStudentCode(id: string): Promise<StudentCodeList> {
  return authedRequest<StudentCodeList>(`/teachers/codes/${id}/revoke`, 'POST', undefined);
}

/** Student side: redeem a code from a teacher. */
export function redeemStudentCode(code: string): Promise<void> {
  return authedRequest<void>('/students/verify-code', 'POST', { code });
}
