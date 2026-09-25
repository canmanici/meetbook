import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
import { EmptyState } from '@/components/ui/emptystate';
import { useToast } from '@/hooks/use-toast';
import { ApiError, listMyBooks, searchUsers } from '@/lib/api/client';
import { chatWS } from '@/lib/api/chat';
import {
  MAX_CLUB_MEMBERS,
  acceptClubInvite,
  clubErrorMessage,
  declineClubInvite,
  deleteClub,
  getClub,
  inviteToClub,
  listClubMessages,
  postClubMessage,
  removeClubMember,
  setMyClubBook,
  shuffleClub,
  type ClubDetail,
  type ClubMember,
  type ClubMessage,
} from '@/lib/api/clubs';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Pastel helper (mirrors chats.tsx for stable accent rings).
// ---------------------------------------------------------------------------

const PASTEL_KEYS = Object.keys(pastels.light) as PastelName[];
function pastelForName(name: string): PastelName {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PASTEL_KEYS[Math.abs(h) % PASTEL_KEYS.length];
}

const errText = (e: unknown) => clubErrorMessage(e instanceof ApiError ? (e.body as any)?.detail : null);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ClubMessage[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  const clubQuery = useQuery({
    queryKey: ['club', id],
    queryFn: () => getClub(id!),
    enabled: !!id,
    retry: false,
  });
  const club = clubQuery.data;
  const isActive = club?.my_status === 'active';

  const setClub = (detail: ClubDetail) => {
    queryClient.setQueryData(['club', id], detail);
    queryClient.invalidateQueries({ queryKey: ['clubs'] });
  };

  // ── Messages: initial page + live WS updates ─────────────────────────
  const messagesQuery = useQuery({
    queryKey: ['club-messages', id],
    queryFn: () => listClubMessages(id!),
    enabled: !!id && isActive,
  });
  useEffect(() => {
    if (messagesQuery.data) setMessages(messagesQuery.data.items);
  }, [messagesQuery.data]);

  const appendMessage = useCallback((m: ClubMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  useEffect(() => {
    if (!id) return;
    chatWS.connect();
    return chatWS.subscribe((msg) => {
      if (msg.club_id !== id) return;
      if (msg.type === 'club_message' && msg.message) {
        appendMessage(msg.message as unknown as ClubMessage);
        // System messages mean membership/shuffle changed → refresh detail.
        if (!msg.message.sender_id) queryClient.invalidateQueries({ queryKey: ['club', id] });
      } else if (msg.type === 'club_updated') {
        // A member picked a book / invite answered / someone removed.
        queryClient.invalidateQueries({ queryKey: ['club', id] });
      } else if (msg.type === 'club_deleted') {
        toast.show('Kulüp silindi', { variant: 'info' });
        queryClient.invalidateQueries({ queryKey: ['clubs'] });
        router.back();
      }
    });
  }, [id, appendMessage, queryClient, router, toast]);

  // Catch up on anything missed while the screen was in the background.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      queryClient.invalidateQueries({ queryKey: ['club', id] });
      queryClient.invalidateQueries({ queryKey: ['club-messages', id] });
    }, [id, queryClient]),
  );

  // ── My library (book picker) ─────────────────────────────────────────
  const { data: myBooksData } = useQuery({
    queryKey: ['books', 'me', 'flat'],
    queryFn: () => listMyBooks({ limit: 50 }),
    enabled: isActive,
    retry: false,
  });
  const myBooks = myBooksData?.items ?? [];

  // ── Mutations ────────────────────────────────────────────────────────
  const onErr = (e: unknown) => toast.show(errText(e), { variant: 'error' });
  const respond = useMutation({
    mutationFn: async (accept: boolean) => (accept ? acceptClubInvite(id!) : declineClubInvite(id!).then(() => null)),
    onSuccess: (detail) => {
      if (detail) setClub(detail);
      else {
        queryClient.invalidateQueries({ queryKey: ['clubs'] });
        router.back();
      }
    },
    onError: onErr,
  });
  const pickBook = useMutation({ mutationFn: (bookId: string) => setMyClubBook(id!, bookId), onSuccess: setClub, onError: onErr });
  const shuffle = useMutation({
    mutationFn: () => shuffleClub(id!),
    onSuccess: (d) => {
      setClub(d);
      toast.show('Kitaplar karıştırıldı! 🎲', { variant: 'success' });
    },
    onError: onErr,
  });
  const invite = useMutation({
    mutationFn: (userId: string) => inviteToClub(id!, userId),
    onSuccess: (d) => {
      setClub(d);
      setInviteQuery('');
      toast.show('Davet gönderildi', { variant: 'success' });
    },
    onError: onErr,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => removeClubMember(id!, userId),
    onSuccess: (_d, userId) => {
      if (userId === currentUser?.id) {
        queryClient.invalidateQueries({ queryKey: ['clubs'] });
        router.back();
      } else {
        queryClient.invalidateQueries({ queryKey: ['club', id] });
      }
    },
    onError: onErr,
  });
  const removeClub = useMutation({
    mutationFn: () => deleteClub(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubs'] });
      router.back();
    },
    onError: onErr,
  });
  const send = useMutation({
    mutationFn: (text: string) => postClubMessage(id!, text),
    onSuccess: (m) => appendMessage(m),
    onError: (e, text) => {
      setInputText(text); // give the text back so nothing is lost
      onErr(e);
    },
  });

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    send.mutate(text);
  };

  const { data: inviteResults, isFetching: inviteSearching } = useQuery({
    queryKey: ['user-search', inviteQuery.trim()],
    queryFn: () => searchUsers(inviteQuery.trim()),
    enabled: showInvite && inviteQuery.trim().length >= 2,
  });

  const members = useMemo(() => club?.members ?? [], [club]);
  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');
  const me = members.find((m) => m.user_id === currentUser?.id);
  const byId = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);
  const hasAssignments = !!club?.shuffled_at;

  // ── Render helpers ───────────────────────────────────────────────────
  const renderMessage = (item: ClubMessage) => {
    if (!item.sender_id) {
      return (
        <View style={styles.systemRow}>
          <View style={[styles.systemPill, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.systemText, { color: colors.textMuted }]}>{item.text}</Text>
          </View>
        </View>
      );
    }
    const isMine = item.sender_id === currentUser?.id;
    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowOther]}>
        {!isMine && <Avatar name={item.sender_name ?? '?'} imageUrl={item.sender_avatar_url ?? undefined} size="small" />}
        <View
          style={[
            styles.bubble,
            isMine ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border },
            !isMine && { marginLeft: spacing.sm },
          ]}
        >
          {!isMine && (
            <Text style={[styles.bubbleName, { color: colors.primary }]} numberOfLines={1}>
              {item.sender_name}
            </Text>
          )}
          <Text style={[styles.bubbleText, { color: isMine ? '#fff' : colors.text }]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  const header = (title: string, count?: number) => (
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
        <Ionicons name="people-circle" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      </View>
      {count !== undefined && (
        <View style={[styles.countPill, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.countText, { color: colors.primary }]}>{count}</Text>
        </View>
      )}
    </View>
  );

  if (clubQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {header('Kitap Kulübü')}
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  if (!club) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {header('Kitap Kulübü')}
        <EmptyState
          icon="people-outline"
          message="Kulüp bulunamadı"
          description="Bu kulüp silinmiş olabilir ya da artık üyesi değilsin."
          actionLabel="Geri Dön"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  // Invitation view — nothing of the club's content before accepting.
  if (!isActive) {
    const owner = members.find((m) => m.is_owner);
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {header(club.name)}
        <View style={[styles.body, { paddingTop: spacing.xl }]}>
          <View style={[styles.poolCard, { backgroundColor: colors.surface, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }, shadows.card]}>
            <Ionicons name="mail-open-outline" size={32} color={colors.primary} style={{ alignSelf: 'center' }} />
            <Text style={[styles.headerTitle, { color: colors.text, textAlign: 'center' }]}>
              {owner?.name ?? 'Biri'} seni “{club.name}” kulübüne davet etti
            </Text>
            <Text style={[styles.hint, { color: colors.textMuted, textAlign: 'center' }]}>
              {active.length} aktif üye. Katılınca kendi kitabını seçip kulüp sohbetine yazabilirsin.
            </Text>
            <Button onPress={() => respond.mutate(true)} loading={respond.isPending} testID="club-accept-btn">
              Katıl
            </Button>
            <TouchableOpacity onPress={() => respond.mutate(false)} style={{ alignItems: 'center' }} testID="club-decline-btn">
              <Text style={[styles.poolAuthor, { color: colors.textMuted, fontWeight: '700' }]}>Daveti reddet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const blockerText = club.shuffle_blockers.includes('NEED_TWO_ACTIVE_MEMBERS')
    ? 'Karıştırmak için en az 2 aktif üye gerekli.'
    : club.shuffle_blockers.includes('MISSING_BOOKS')
      ? 'Karıştırmadan önce her üyenin bir kitap seçmesi gerekiyor.'
      : null;

  const confirmLeave = () =>
    Alert.alert('Kulüpten ayrıl', `“${club.name}” kulübünden ayrılmak istiyor musun?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayrıl', style: 'destructive', onPress: () => currentUser && removeMember.mutate(currentUser.id) },
    ]);
  const confirmDelete = () =>
    Alert.alert('Kulübü sil', 'Kulüp ve tüm mesajları herkes için silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeClub.mutate() },
    ]);
  const confirmRemove = (m: ClubMember) =>
    Alert.alert('Üyeyi çıkar', `${m.name} kulüpten çıkarılsın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkar', style: 'destructive', onPress: () => removeMember.mutate(m.user_id) },
    ]);

  const inviteCandidates = (inviteResults?.items ?? []).filter(
    (u) => u.id !== currentUser?.id && !members.some((m) => m.user_id === u.id),
  );
  const full = members.length >= MAX_CLUB_MEMBERS;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {header(club.name, active.length)}

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={{ paddingBottom: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Members grid */}
        <SectionTitle colors={colors}>Üyeler</SectionTitle>
        <View style={styles.grid}>
          {members.map((m) => {
            const pastel = pastels[isDark ? 'dark' : 'light'][pastelForName(m.name)];
            const isMe = m.user_id === currentUser?.id;
            return (
              <TouchableOpacity
                key={m.user_id}
                style={[styles.gridCell, m.status === 'invited' && { opacity: 0.55 }]}
                onLongPress={club.is_owner && !m.is_owner ? () => confirmRemove(m) : undefined}
                activeOpacity={0.8}
                testID={`club-member-${m.user_id}`}
              >
                <View style={[styles.avatarRing, { borderColor: pastel.bg }]}>
                  <Avatar name={m.name} imageUrl={m.avatar_url ?? undefined} size="medium" />
                </View>
                <Text style={[styles.gridName, { color: colors.text }]} numberOfLines={1}>{m.name}</Text>
                <Text style={[styles.gridSub, { color: isMe ? colors.primary : colors.textMuted }]} numberOfLines={1}>
                  {m.status === 'invited' ? 'davet bekliyor' : isMe ? 'Sen' : m.is_owner ? 'Kurucu' : m.book ? m.book.title : 'kitap seçmedi'}
                </Text>
              </TouchableOpacity>
            );
          })}
          {club.is_owner && !full && (
            <TouchableOpacity style={styles.gridCell} onPress={() => setShowInvite((v) => !v)} testID="club-invite-toggle">
              <View style={[styles.addCircle, { borderColor: colors.primary }]}>
                <Ionicons name={showInvite ? 'close' : 'person-add'} size={22} color={colors.primary} />
              </View>
              <Text style={[styles.gridName, { color: colors.primary }]}>Davet et</Text>
            </TouchableOpacity>
          )}
        </View>
        {club.is_owner && members.length > 1 && (
          <Text style={[styles.hint, { color: colors.textMuted }]}>Bir üyeyi çıkarmak için üzerine uzun bas.</Text>
        )}

        {showInvite && (
          <View style={{ marginTop: spacing.md }}>
            <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="İsim veya kullanıcı adı..."
                placeholderTextColor={colors.textMuted}
                value={inviteQuery}
                onChangeText={setInviteQuery}
                autoCapitalize="none"
                autoCorrect={false}
                testID="club-invite-search"
              />
              {inviteSearching && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
            {inviteCandidates.slice(0, 5).map((u) => (
              <TouchableOpacity
                key={u.id}
                style={[styles.poolRow, { backgroundColor: colors.surface, borderRadius: radius.field, marginTop: spacing.xs }]}
                onPress={() => invite.mutate(u.id)}
                disabled={invite.isPending}
                testID={`club-invite-${u.id}`}
              >
                <Avatar name={u.name} imageUrl={u.avatar_url ?? undefined} size="small" />
                <Text style={[styles.poolTitle, { color: colors.text, flex: 1, marginLeft: spacing.sm }]} numberOfLines={1}>
                  {u.name}{u.username ? `  @${u.username}` : ''}
                </Text>
                <Ionicons name="add-circle" size={22} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* My book */}
        <SectionTitle colors={colors}>Senin Kitabın</SectionTitle>
        {myBooks.length === 0 ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Kitaplığın boş — önce bir kitap ekle, sonra buradan seç.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {myBooks.map((book) => {
              const selected = me?.book?.id === book.id;
              return (
                <TouchableOpacity
                  key={book.id}
                  onPress={() => !selected && pickBook.mutate(book.id)}
                  disabled={pickBook.isPending}
                  style={[
                    styles.bookChip,
                    selected
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  ]}
                  testID={`club-book-${book.id}`}
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

        {/* Book pool */}
        <SectionTitle colors={colors}>Kitap Havuzu</SectionTitle>
        <View style={[styles.poolCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          {active.map((m, i) => (
            <View
              key={m.user_id}
              style={[
                styles.poolRow,
                i < active.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
            >
              <Ionicons name="book-outline" size={16} color={m.book ? colors.primary : colors.textMuted} style={{ marginRight: spacing.sm }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.poolTitle, { color: m.book ? colors.text : colors.textMuted }]} numberOfLines={1}>
                  {m.book ? m.book.title : 'Henüz kitap seçilmedi'}
                </Text>
                {m.book?.author ? (
                  <Text style={[styles.poolAuthor, { color: colors.textMuted }]} numberOfLines={1}>{m.book.author}</Text>
                ) : null}
              </View>
              <Text style={[styles.poolOwner, { color: colors.textMuted }]} numberOfLines={1}>{m.name}</Text>
            </View>
          ))}
        </View>

        {/* Shuffle (owner only) + assignments */}
        {club.is_owner && (
          <View style={styles.shuffleWrap}>
            <Button
              onPress={() => shuffle.mutate()}
              disabled={!club.can_shuffle || shuffle.isPending}
              loading={shuffle.isPending}
              testID="club-shuffle-btn"
            >
              {hasAssignments ? 'Yeniden Karıştır' : 'Karıştır'}
            </Button>
          </View>
        )}
        {blockerText && !hasAssignments && (
          <Text style={[styles.hint, { color: colors.textMuted }]}>{blockerText}</Text>
        )}

        {hasAssignments ? (
          <>
            <SectionTitle colors={colors}>Eşleşmeler</SectionTitle>
            <View style={[styles.assignCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
              {active.map((m, i) => {
                const giver = m.receives_from_user_id ? byId[m.receives_from_user_id] : undefined;
                const isMe = m.user_id === currentUser?.id;
                return (
                  <View
                    key={m.user_id}
                    style={[
                      styles.assignRow,
                      i < active.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={[styles.avatarRing, { borderColor: pastels[isDark ? 'dark' : 'light'][pastelForName(m.name)].bg, marginRight: spacing.sm }]}>
                      <Avatar name={m.name} imageUrl={m.avatar_url ?? undefined} size="small" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.assignName, { color: colors.text }]} numberOfLines={1}>{m.name}</Text>
                      <Text style={[styles.assignBook, { color: isMe ? colors.primary : colors.textMuted }]} numberOfLines={2}>
                        {isMe ? 'Sana ' : ''}
                        <Text style={{ fontWeight: '800', color: isMe ? colors.primary : colors.text }}>
                          {giver?.book?.title ?? '—'}
                        </Text>
                        {giver ? ` (${giver.name})` : ''}
                        {isMe ? ' düştü!' : ' düştü.'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : !club.is_owner ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Herkes kitabını seçince kulüp kurucusu kitapları karıştıracak.
          </Text>
        ) : null}

        {/* Group chat */}
        <SectionTitle colors={colors}>Kulüp Sohbeti</SectionTitle>
        <View style={[styles.chatBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {messagesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.lg }} />
          ) : messages.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg }]}>
              Henüz mesaj yok. İlk mesajı sen yaz!
            </Text>
          ) : (
            <ScrollView
              ref={chatScrollRef}
              nestedScrollEnabled
              contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
              // Keep the newest message in view.
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m) => (
                <View key={m.id}>{renderMessage(m)}</View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Leave / delete */}
        <TouchableOpacity
          onPress={club.is_owner ? confirmDelete : confirmLeave}
          style={styles.dangerLink}
          testID={club.is_owner ? 'club-delete-btn' : 'club-leave-btn'}
        >
          <Text style={[styles.poolAuthor, { color: colors.danger, fontWeight: '800' }]}>
            {club.is_owner ? 'Kulübü sil' : 'Kulüpten ayrıl'}
          </Text>
        </TouchableOpacity>
        {invited.length > 0 && (
          <Text style={[styles.hint, { color: colors.textMuted, textAlign: 'center' }]}>
            {invited.length} kişi davetini henüz yanıtlamadı.
          </Text>
        )}
      </ScrollView>

      {/* Chat input */}
      <View
        style={[
          styles.inputBar,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm, borderTopColor: colors.border },
        ]}
      >
        <View style={[styles.inputWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, flex: 1 }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Mesaj yaz..."
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            maxLength={2000}
            testID="club-chat-input"
            accessibilityLabel="Kulüp mesajı yaz"
          />
        </View>
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: colors.primary }, (!inputText.trim() || send.isPending) && { opacity: 0.4 }]}
          onPress={handleSend}
          disabled={!inputText.trim() || send.isPending}
          accessibilityRole="button"
          accessibilityLabel="Mesaj gönder"
          testID="club-send-btn"
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// SectionTitle
// ---------------------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode; colors: ThemeColors }> = ({ children, colors }) => (
  <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{children}</Text>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: spacing.xs, marginRight: spacing.xs },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: fontSize.title, fontWeight: '800', letterSpacing: -0.2 },
  countPill: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: { fontSize: fontSize.caption, fontWeight: '800' },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  hint: { fontSize: fontSize.caption, marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridCell: { alignItems: 'center', width: 80 },
  avatarRing: { padding: 2, borderRadius: 999, borderWidth: 2 },
  addCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridName: { fontSize: fontSize.bodySm, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' },
  gridSub: { fontSize: fontSize.caption, marginTop: 1, textAlign: 'center' },
  bookChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    marginRight: spacing.sm,
    maxWidth: 220,
  },
  bookChipTitle: { fontSize: fontSize.bodySm, fontWeight: '800' },
  bookChipAuthor: { fontSize: fontSize.caption, marginTop: 1 },
  poolCard: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  poolTitle: { fontSize: fontSize.bodySm, fontWeight: '700' },
  poolAuthor: { fontSize: fontSize.caption, marginTop: 1 },
  poolOwner: { fontSize: fontSize.caption, fontWeight: '700', marginLeft: spacing.sm, maxWidth: 90 },
  shuffleWrap: { marginTop: spacing.lg },
  assignCard: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  assignName: { fontSize: fontSize.bodySm, fontWeight: '700' },
  assignBook: { fontSize: fontSize.bodySm, marginTop: 2 },
  chatBox: { borderRadius: radius.card, borderWidth: 1, minHeight: 160, maxHeight: 360 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bubbleName: { fontSize: fontSize.caption, fontWeight: '800', marginBottom: 2 },
  bubbleText: { fontSize: fontSize.bodySm, lineHeight: 19 },
  systemRow: { alignItems: 'center' },
  systemPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  systemText: { fontSize: fontSize.caption, fontStyle: 'italic', textAlign: 'center' },
  dangerLink: { alignItems: 'center', paddingVertical: spacing.lg },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 46,
    borderRadius: radius.field,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: fontSize.bodySm, padding: 0 },
  sendBtn: { width: 46, height: 46, borderRadius: radius.field, justifyContent: 'center', alignItems: 'center' },
});
