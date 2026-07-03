import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import {
  palette,
  pastels,
  spacing,
  fontSize,
  radius,
  shadows,
  type ThemeColors,
  type PastelName,
} from '@/components/ui/tokens';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { listMyBooks } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

import {
  saveClub,
  makeClubId,
  addClubIndexEntry,
  type Club,
  type ClubMember,
  type ClubBook,
} from './_layout';

// ---------------------------------------------------------------------------
// Mock library used for non-current-user members (no backend search yet).
// ---------------------------------------------------------------------------

const MOCK_LIBRARY: ClubBook[] = [
  { title: 'Tutunamayanlar', author: 'Oğuz Atay' },
  { title: 'Kürk Mantolu Madonna', author: 'Sabahattin Ali' },
  { title: 'Saatleri Ayarlama Enstitüsü', author: 'Ahmet Hamdi Tanpınar' },
  { title: 'Beyaz Geceler', author: 'Fyodor Dostoyevski' },
  { title: 'Hayvan Çiftliği', author: 'George Orwell' },
];

const MAX_MEMBERS = 5;

// ---------------------------------------------------------------------------
// Pastel helper (mirrors the one in chats.tsx for stable accent rings).
// ---------------------------------------------------------------------------

const PASTEL_KEYS = Object.keys(pastels.light) as PastelName[];
function pastelForName(name: string): PastelName {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PASTEL_KEYS[Math.abs(h) % PASTEL_KEYS.length];
}

function makeMockMemberId(): string {
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CreateClubScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const currentUser = useAuthStore((s) => s.user);

  const [clubName, setClubName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<ClubMember[]>([]);
  const seededRef = useRef(false);

  // Current user's real library.
  const { data: myBooksData, isLoading: myBooksLoading } = useQuery({
    queryKey: ['books', 'me', 'flat'],
    queryFn: () => listMyBooks({ limit: 50 }),
    retry: false,
  });

  const myBooks: ClubBook[] = useMemo(
    () =>
      (myBooksData?.items ?? [])
        .map((b) => ({ title: b.title, author: b.author ?? undefined }))
        .filter((b) => Boolean(b.title)),
    [myBooksData],
  );

  // Seed the current user as the first member once we know their id.
  useEffect(() => {
    if (seededRef.current) return;
    if (!currentUser) return;
    seededRef.current = true;
    setMembers((prev) => {
      if (prev.some((m) => m.id === currentUser.id)) return prev;
      return [
        {
          id: currentUser.id,
          name: currentUser.name,
          avatarUrl: currentUser.avatarUrl,
          book: { title: '' },
        },
        ...prev,
      ];
    });
  }, [currentUser]);

  // Auto-pick the current user's book when their library arrives.
  useEffect(() => {
    if (myBooks.length === 0 || !currentUser) return;
    setMembers((prev) =>
      prev.map((m) =>
        m.id === currentUser.id && !m.book.title
          ? { ...m, book: myBooks[0] }
          : m,
      ),
    );
  }, [myBooks, currentUser]);

  const addMember = () => {
    const name = searchQuery.trim();
    if (!name) return;
    if (members.length >= MAX_MEMBERS) return;
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      setSearchQuery('');
      return;
    }
    const member: ClubMember = {
      id: makeMockMemberId(),
      name,
      book: pickRandom(MOCK_LIBRARY),
    };
    setMembers((prev) => [...prev, member]);
    setSearchQuery('');
  };

  const removeMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const pickBook = (memberId: string, book: ClubBook) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, book } : m)),
    );
  };

  const allHaveBooks = members.length > 0 && members.every((m) => m.book.title);
  const canCreate =
    clubName.trim().length > 0 && members.length >= 2 && allHaveBooks;

  const handleCreate = () => {
    if (!canCreate) return;
    const club: Club = {
      id: makeClubId(),
      name: clubName.trim(),
      members,
      assignments: {},
      createdAt: new Date().toISOString(),
    };
    saveClub(club);
    addClubIndexEntry({ id: club.id, name: club.name, createdAt: club.createdAt }).catch(() => {});
    router.push(`/chat/club/${club.id}`);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xs, borderBottomColor: colors.border },
          shadows.card,
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Geri"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="people-circle" size={22} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Kitap Kulübü</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Club name */}
        <Text style={[styles.label, { color: colors.textMuted }]}>Kulüp Adı</Text>
        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="bookmark-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Örn. Cumartesi Okurları"
            placeholderTextColor={colors.textMuted}
            value={clubName}
            onChangeText={setClubName}
            testID="club-name-input"
            accessibilityLabel="Kulüp adı"
            maxLength={40}
          />
        </View>

        {/* Member search */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: spacing.lg }]}>
          Üye Ekle ({members.length}/{MAX_MEMBERS})
        </Text>
        <View style={[styles.searchRow]}>
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: colors.surface, borderColor: colors.border },
              members.length >= MAX_MEMBERS && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="İsim veya telefon..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              testID="member-search-input"
              accessibilityLabel="Üye ara"
              editable={members.length < MAX_MEMBERS}
              returnKeyType="search"
              onSubmitEditing={addMember}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.searchBtn,
              { backgroundColor: colors.primary },
              (members.length >= MAX_MEMBERS || !searchQuery.trim()) && { opacity: 0.4 },
            ]}
            onPress={addMember}
            disabled={members.length >= MAX_MEMBERS || !searchQuery.trim()}
            accessibilityRole="button"
            accessibilityLabel="Üye ekle"
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Mock arama — yazdığın isim direkt üye olarak eklenir.
        </Text>

        {/* Members */}
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isMe={!!currentUser && m.id === currentUser.id}
            isDark={isDark}
            colors={colors}
            library={currentUser && m.id === currentUser.id ? myBooks : MOCK_LIBRARY}
            libraryLoading={!!currentUser && m.id === currentUser.id && myBooksLoading}
            onRemove={() => removeMember(m.id)}
            onPickBook={(book) => pickBook(m.id, book)}
            canRemove={members.length > 1}
          />
        ))}

        {members.length < 2 && (
          <Text style={[styles.hint, { color: colors.textMuted, marginTop: spacing.md }]}>
            Karıştırma için en az 2 üye gerekli.
          </Text>
        )}
      </ScrollView>

      {/* Footer CTA */}
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.border },
        ]}
      >
        <Button onPress={handleCreate} disabled={!canCreate} testID="club-create-btn">
          Oluştur
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// MemberRow — avatar + name + remove + book picker
// ---------------------------------------------------------------------------

interface MemberRowProps {
  member: ClubMember;
  isMe: boolean;
  isDark: boolean;
  colors: ThemeColors;
  library: ClubBook[];
  libraryLoading: boolean;
  onRemove: () => void;
  onPickBook: (book: ClubBook) => void;
  canRemove: boolean;
}

const MemberRow: React.FC<MemberRowProps> = ({
  member,
  isMe,
  isDark,
  colors,
  library,
  libraryLoading,
  onRemove,
  onPickBook,
  canRemove,
}) => {
  const pastel = pastels[isDark ? 'dark' : 'light'][pastelForName(member.name)];
  return (
    <View style={[styles.memberCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
      <View style={styles.memberHead}>
        <View style={[styles.avatarRing, { borderColor: pastel.bg }]}>
          <Avatar name={member.name} imageUrl={member.avatarUrl} size="small" />
        </View>
        <View style={styles.memberInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
              {member.name}
            </Text>
            {isMe && (
              <View style={[styles.youBadge, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.youBadgeText, { color: colors.primary }]}>Sen</Text>
              </View>
            )}
          </View>
          <Text style={[styles.memberSub, { color: colors.textMuted }]} numberOfLines={1}>
            {member.book.title ? `${member.book.title}${member.book.author ? ' · ' + member.book.author : ''}` : 'Kitap seçilmedi'}
          </Text>
        </View>
        {canRemove && !isMe && (
          <TouchableOpacity
            onPress={onRemove}
            style={[styles.removeBtn, { borderColor: colors.danger + '55' }]}
            accessibilityRole="button"
            accessibilityLabel={`${member.name} üyeyi kaldır`}
          >
            <Text style={[styles.removeText, { color: colors.danger }]}>kaldır</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Book picker */}
      <Text style={[styles.pickerLabel, { color: colors.textMuted }]}>
        {isMe ? 'Kitaplığından bir kitap seç' : 'Kitap seç'}
      </Text>
      {libraryLoading ? (
        <View style={styles.pickerLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : library.length === 0 ? (
        <Text style={[styles.emptyLibrary, { color: colors.textMuted }]}>
          {isMe ? 'Kitaplığın boş — önce kitap ekle.' : 'Kitap yok.'}
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
          {library.map((book, idx) => {
            const selected = member.book.title === book.title;
            return (
              <TouchableOpacity
                key={`${book.title}-${idx}`}
                onPress={() => onPickBook(book)}
                style={[
                  styles.bookChip,
                  selected
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${book.title} kitabını seç`}
              >
                <Text
                  style={[styles.bookChipTitle, { color: selected ? '#fff' : colors.text }]}
                  numberOfLines={1}
                >
                  {book.title}
                </Text>
                {book.author ? (
                  <Text
                    style={[styles.bookChipAuthor, { color: selected ? '#FFFFFFCC' : colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {book.author}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: spacing.xs, marginRight: spacing.xs },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  // Body
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.field,
    borderWidth: 1,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodySm,
    padding: 0,
  },
  // Search row
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.field,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
  },
  // Member card
  memberCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  memberHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRing: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
    marginRight: spacing.md,
  },
  memberInfo: { flex: 1, gap: 2 },
  memberName: {
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  memberSub: {
    fontSize: fontSize.caption,
  },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  removeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  removeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  // Picker
  pickerLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  pickerLoading: { paddingVertical: spacing.sm },
  emptyLibrary: {
    fontSize: fontSize.caption,
    paddingVertical: spacing.sm,
  },
  pickerScroll: { flexDirection: 'row' },
  bookChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    marginRight: spacing.sm,
    maxWidth: 220,
  },
  bookChipTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  bookChipAuthor: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  // Footer
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
