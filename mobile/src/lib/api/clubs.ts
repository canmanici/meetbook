/**
 * Book clubs — real backend (/api/v1/clubs). Live messages arrive over the
 * chat WebSocket as {type: 'club_message', club_id, message}.
 */
import { authedRequest } from '@/lib/api/client';

export const MAX_CLUB_MEMBERS = 5;

export type ClubMemberStatus = 'invited' | 'active';

export interface ClubBook {
  id: string;
  title: string;
  author: string | null;
  thumbnail_url: string | null;
}

export interface ClubMember {
  user_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  status: ClubMemberStatus;
  is_owner: boolean;
  book: ClubBook | null;
  /** After a shuffle: whose book this member receives. */
  receives_from_user_id: string | null;
}

export interface ClubMessage {
  id: string;
  club_id: string;
  sender_id: string | null; // null = system message
  sender_name: string | null;
  sender_avatar_url: string | null;
  text: string;
  created_at: string;
}

export interface ClubDetail {
  id: string;
  name: string;
  owner_id: string;
  my_status: ClubMemberStatus;
  is_owner: boolean;
  shuffled_at: string | null;
  created_at: string;
  members: ClubMember[];
  can_shuffle: boolean;
  shuffle_blockers: ('NEED_TWO_ACTIVE_MEMBERS' | 'MISSING_BOOKS')[];
}

export interface ClubSummary {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  my_status: ClubMemberStatus;
  active_count: number;
  invited_count: number;
  shuffled_at: string | null;
  created_at: string;
  last_message: ClubMessage | null;
}

export const listClubs = () => authedRequest<{ items: ClubSummary[] }>('/clubs', 'GET', undefined);

export const getClub = (id: string) => authedRequest<ClubDetail>(`/clubs/${id}`, 'GET', undefined);

export const createClub = (body: { name: string; member_ids: string[]; book_id?: string | null }) =>
  authedRequest<ClubDetail>('/clubs', 'POST', body);

export const deleteClub = (id: string) => authedRequest<void>(`/clubs/${id}`, 'DELETE', undefined);

export const acceptClubInvite = (id: string) => authedRequest<ClubDetail>(`/clubs/${id}/accept`, 'POST', undefined);

export const declineClubInvite = (id: string) => authedRequest<void>(`/clubs/${id}/decline`, 'POST', undefined);

export const inviteToClub = (id: string, userId: string) =>
  authedRequest<ClubDetail>(`/clubs/${id}/members`, 'POST', { user_id: userId });

/** Owner removes a member, or pass your own id to leave. */
export const removeClubMember = (id: string, userId: string) =>
  authedRequest<void>(`/clubs/${id}/members/${userId}`, 'DELETE', undefined);

export const setMyClubBook = (id: string, bookId: string | null) =>
  authedRequest<ClubDetail>(`/clubs/${id}/my-book`, 'PUT', { book_id: bookId });

export const shuffleClub = (id: string) => authedRequest<ClubDetail>(`/clubs/${id}/shuffle`, 'POST', undefined);

export const listClubMessages = (id: string, before?: string) =>
  authedRequest<{ items: ClubMessage[]; has_more: boolean }>(`/clubs/${id}/messages`, 'GET', undefined, {
    query: { before, limit: 50 },
  });

export const postClubMessage = (id: string, text: string) =>
  authedRequest<ClubMessage>(`/clubs/${id}/messages`, 'POST', { text });

/** Turkish copy for backend error codes. */
export function clubErrorMessage(code: unknown): string {
  const map: Record<string, string> = {
    NEED_TWO_ACTIVE_MEMBERS: 'Karıştırmak için en az 2 aktif üye gerekli.',
    MISSING_BOOKS: 'Karıştırmadan önce her üyenin bir kitap seçmesi gerekiyor.',
    CLUB_FULL: `Kulüp dolu (en fazla ${MAX_CLUB_MEMBERS} kişi).`,
    ALREADY_MEMBER: 'Bu kişi zaten kulüpte.',
    USER_NOT_FOUND: 'Kullanıcı bulunamadı.',
    CANNOT_INVITE_SELF: 'Kendini davet edemezsin.',
    NOT_OWNER: 'Bu işlemi sadece kulüp kurucusu yapabilir.',
    OWNER_CANNOT_LEAVE: 'Kurucu kulüpten ayrılamaz; kulübü silebilirsin.',
    BOOK_NOT_FOUND: 'Kitap bulunamadı.',
    NOT_FOUND: 'Kulüp bulunamadı.',
  };
  return (typeof code === 'string' && map[code]) || 'Bir şeyler ters gitti. Tekrar dene.';
}
