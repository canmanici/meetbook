import { Stack } from 'expo-router';

// ---------------------------------------------------------------------------
// In-memory mock store for book clubs.
// No backend support yet — shared between create.tsx and [id].tsx via this
// module singleton (a module is evaluated once, so the Map persists while the
// app is alive).
// ---------------------------------------------------------------------------

export interface ClubBook {
  title: string;
  author?: string;
}

export interface ClubMember {
  id: string;
  name: string;
  phone?: string;
  book: ClubBook;
}

export interface Club {
  id: string;
  name: string;
  members: ClubMember[];
  /** memberId -> id of the member whose book this member receives. */
  assignments: Record<string, string>;
  createdAt: string;
}

const CLUBS = new Map<string, Club>();

export function saveClub(club: Club): void {
  CLUBS.set(club.id, club);
}

export function getClub(id: string): Club | undefined {
  return CLUBS.get(id);
}

export function makeClubId(): string {
  return `club-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a derangement of member ids: nobody receives their own book.
 * Retries up to 1000 times (trivial for n ≤ 5), then falls back to a rotation.
 */
export function shuffleAssignments(members: ClubMember[]): Record<string, string> {
  const n = members.length;
  if (n < 2) return {};
  const ids = members.map((m) => m.id);

  for (let attempt = 0; attempt < 1000; attempt++) {
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (shuffled[i] === ids[i]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const map: Record<string, string> = {};
      for (let i = 0; i < n; i++) map[ids[i]] = shuffled[i];
      return map;
    }
  }

  // Fallback: rotate by one (guaranteed derangement for n >= 2).
  const map: Record<string, string> = {};
  for (let i = 0; i < n; i++) map[ids[i]] = ids[(i + 1) % n];
  return map;
}

export default function ClubLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
