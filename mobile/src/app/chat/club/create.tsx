import React, { useEffect, useMemo, useState } from 'react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ApiError, listMyBooks, searchUsers, type UserSearchResult } from '@/lib/api/client';
import { MAX_CLUB_MEMBERS, clubErrorMessage, createClub } from '@/lib/api/clubs';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Pastel helper (mirrors the one in chats.tsx for stable accent rings).
// ---------------------------------------------------------------------------

const PASTEL_KEYS = Object.keys(pastels.light) as PastelName[];
function pastelForName(name: string): PastelName {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PASTEL_KEYS[Math.abs(h) % PASTEL_KEYS.length];
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------------------
// Screen — create a club with REAL users. Invitees must accept; each member
// then picks their own book inside the club.
// ---------------------------------------------------------------------------

export default function CreateClubScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [clubName, setClubName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [invitees, setInvitees] = useState<UserSearchResult[]>([]);
  const [myBookId, setMyBookId] = useState<string | null>(null);
  const debouncedQuery = useDebounced(searchQuery.trim(), 300);

  const { data: myBooksData, isLoading: myBooksLoading } = useQuery({
    queryKey: ['books', 'me', 'flat'],
    queryFn: () => listMyBooks({ limit: 50 }),
    retry: false,
  });
  const myBooks = useMemo(() => myBooksData?.items ?? [], [myBooksData]);

  // Preselect the first book once the library arrives.
  useEffect(() => {
    if (!myBookId && myBooks.length > 0) setMyBookId(myBooks[0].id);
  }, [myBooks, myBookId]);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['user-search', debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });
  const results = (searchData?.items ?? []).filter(
    (u) => u.id !== currentUser?.id && !invitees.some((i) => i.id === u.id),
  );

  const full = invitees.length + 1 >= MAX_CLUB_MEMBERS;
  const addInvitee = (u: UserSearchResult) => {
    if (full) return;
    setInvitees((prev) => [...prev, u]);
    setSearchQuery('');
  };

  const create = useMutation({
    mutationFn: () =>
      createClub({ name: clubName.trim(), member_ids: invitees.map((i) => i.id), book_id: myBookId }),
    onSuccess: (club) => {
      queryClient.invalidateQueries({ queryKey: ['clubs'] });
      toast.show(
        invitees.length ? `Kulüp kuruldu, ${invitees.length} kişiye davet gönderildi` : 'Kulüp kuruldu',
        { variant: 'success' },
      );
      router.replace(`/chat/club/${club.id}`);
    },
    onError: (e) =>
      toast.show(clubErrorMessage(e instanceof ApiError ? (e.body as any)?.detail : null), { variant: 'error' }),
  });

  const canCreate = clubName.trim().length > 0 && !create.isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, paddingTop: insets.top + spacing.xs, borderBottomColor: colors.border },
          shadows.card,
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Geri">
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
            maxLength={60}
          />
        </View>

        {/* My book */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: spacing.lg }]}>Senin Kitabın</Text>
        {myBooksLoading ? (
          <View style={styles.pickerLoading}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : myBooks.length === 0 ? (
          <Text style={[styles.emptyLibrary, { color: colors.textMuted }]}>
            Kitaplığın boş — kulübü kurabilirsin, kitabını sonra seçersin.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {myBooks.map((book) => {
              const selected = myBookId === book.id;
              return (
                <TouchableOpacity
                  key={book.id}
                  onPress={() => setMyBookId(book.id)}
                  style={[
                    styles.bookChip,
                    selected
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${book.title} kitabını seç`}
                >
                  <Text style={[styles.bookChipTitle, { color: selected ? '#fff' : colors.text }]} numberOfLines={1}>
                    {book.title}
                  </Text>
                  {book.author ? (
                    <Text style={[styles.bookChipAuthor, { color: selected ? '#FFFFFFCC' : colors.textMuted }]} numberOfLines={1}>
                      {book.author}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Member search (real users) */}
        <Text style={[styles.label, { color: colors.textMuted, marginTop: spacing.lg }]}>
          Üye Davet Et ({invitees.length + 1}/{MAX_CLUB_MEMBERS})
        </Text>
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: colors.surface, borderColor: colors.border },
              full && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="İsim veya kullanıcı adı..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              testID="member-search-input"
              accessibilityLabel="Üye ara"
              editable={!full}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
        </View>
        {debouncedQuery.length >= 2 && !full && (
          <View style={[styles.results, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {results.length === 0 && !searching ? (
              <Text style={[styles.hint, { color: colors.textMuted, padding: spacing.md, marginTop: 0 }]}>
                Kullanıcı bulunamadı.
              </Text>
            ) : (
              results.slice(0, 6).map((u, i) => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => addInvitee(u)}
                  style={[
                    styles.resultRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                  testID={`member-result-${u.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${u.name} davet et`}
                >
                  <Avatar name={u.name} imageUrl={u.avatar_url ?? undefined} size="small" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{u.name}</Text>
                    {u.username ? (
                      <Text style={[styles.memberSub, { color: colors.textMuted }]}>@{u.username}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="add-circle" size={22} color={colors.primary} />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Davet ettiğin kişiler kabul edince kulübe katılır ve kendi kitabını seçer.
        </Text>

        {/* Members */}
        {currentUser && (
          <MemberRow name={currentUser.name} avatarUrl={currentUser.avatarUrl} isMe isDark={isDark} colors={colors} />
        )}
        {invitees.map((u) => (
          <MemberRow
            key={u.id}
            name={u.name}
            subtitle={u.username ? `@${u.username} · davet edilecek` : 'davet edilecek'}
            avatarUrl={u.avatar_url ?? undefined}
            isMe={false}
            isDark={isDark}
            colors={colors}
            onRemove={() => setInvitees((prev) => prev.filter((x) => x.id !== u.id))}
          />
        ))}
      </ScrollView>

      {/* Footer CTA */}
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.border },
        ]}
      >
        <Button onPress={() => create.mutate()} disabled={!canCreate} loading={create.isPending} testID="club-create-btn">
          Oluştur
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// MemberRow — avatar + name + remove
// ---------------------------------------------------------------------------

interface MemberRowProps {
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  isMe: boolean;
  isDark: boolean;
  colors: ThemeColors;
  onRemove?: () => void;
}

const MemberRow: React.FC<MemberRowProps> = ({ name, subtitle, avatarUrl, isMe, isDark, colors, onRemove }) => {
  const pastel = pastels[isDark ? 'dark' : 'light'][pastelForName(name)];
  return (
    <View style={[styles.memberCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
      <View style={styles.memberHead}>
        <View style={[styles.avatarRing, { borderColor: pastel.bg }]}>
          <Avatar name={name} imageUrl={avatarUrl} size="small" />
        </View>
        <View style={styles.memberInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            {isMe && (
              <View style={[styles.youBadge, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.youBadgeText, { color: colors.primary }]}>Sen · Kurucu</Text>
              </View>
            )}
          </View>
          {subtitle ? (
            <Text style={[styles.memberSub, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        {onRemove && (
          <TouchableOpacity
            onPress={onRemove}
            style={[styles.removeBtn, { borderColor: colors.danger + '55' }]}
            accessibilityRole="button"
            accessibilityLabel={`${name} davetini kaldır`}
          >
            <Text style={[styles.removeText, { color: colors.danger }]}>kaldır</Text>
          </TouchableOpacity>
        )}
      </View>
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
  // Search results
  results: { marginTop: spacing.sm, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Footer
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
