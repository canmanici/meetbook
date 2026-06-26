import React, { useEffect, useRef, useState, useCallback } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { EmptyState } from '@/components/ui/emptystate';
import { useAuthStore } from '@/stores/auth-store';

import {
  getClub,
  saveClub,
  shuffleAssignments,
  type Club,
  type ClubMember,
} from './_layout';

// ---------------------------------------------------------------------------
// Pastel helper (mirrors chats.tsx for stable accent rings).
// ---------------------------------------------------------------------------

const PASTEL_KEYS = Object.keys(pastels.light) as PastelName[];
function pastelForName(name: string): PastelName {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PASTEL_KEYS[Math.abs(h) % PASTEL_KEYS.length];
}

// ---------------------------------------------------------------------------
// Local chat message type (mock — no backend).
// ---------------------------------------------------------------------------

interface ClubMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  at: string;
}

function makeMsgId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

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

  const currentUser = useAuthStore((s) => s.user);

  const [club, setClub] = useState<Club | undefined>(() => (id ? getClub(id) : undefined));
  const [messages, setMessages] = useState<ClubMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const seededChatRef = useRef(false);

  // Re-read club from the in-memory store when id changes.
  useEffect(() => {
    if (id) setClub(getClub(id));
  }, [id]);

  // Seed a couple of mock messages so the chat feels alive.
  useEffect(() => {
    if (seededChatRef.current) return;
    if (!club || club.members.length === 0) return;
    seededChatRef.current = true;
    const others = club.members.filter((m) => m.id !== currentUser?.id);
    const seed: ClubMessage[] = [
      {
        id: makeMsgId(),
        senderId: 'system',
        senderName: 'Sistem',
        text: `${club.name} kuruldu! ${club.members.length} okur katıldı.`,
        at: club.createdAt,
      },
    ];
    if (others.length > 0) {
      seed.push({
        id: makeMsgId(),
        senderId: others[0].id,
        senderName: others[0].name,
        text: 'Merhaba! Benim kitabımı merak ediyorum, bakalım kime denk gelecek 📚',
        at: new Date().toISOString(),
      });
    }
    setMessages(seed);
  }, [club, currentUser]);

  const handleShuffle = useCallback(() => {
    if (!club) return;
    const assignments = shuffleAssignments(club.members);
    const updated: Club = { ...club, assignments };
    saveClub(updated);
    setClub(updated);
  }, [club]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !currentUser) return;
    const msg: ClubMessage = {
      id: makeMsgId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    setInputText('');

    // Mock auto-reply from a random other member for delight.
    if (club) {
      const others = club.members.filter((m) => m.id !== currentUser.id);
      if (others.length > 0 && Math.random() < 0.6) {
        const replier = others[Math.floor(Math.random() * others.length)];
        const replies = [
          'Aynı fikirdeyim!',
          'Bence de öyle.',
          'Birazdan karıştırma yapalım mı?',
          'Benim kitabım kime gelir acaba?',
          'Harbir okuma olsun 🌿',
        ];
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: makeMsgId(),
              senderId: replier.id,
              senderName: replier.name,
              text: replies[Math.floor(Math.random() * replies.length)],
              at: new Date().toISOString(),
            },
          ]);
        }, 900);
      }
    }
  }, [inputText, currentUser, club]);

  const renderMessage = useCallback(
    ({ item }: { item: ClubMessage }) => {
      const isSystem = item.senderId === 'system';
      const isMine = !!currentUser && item.senderId === currentUser.id;
      if (isSystem) {
        return (
          <View style={styles.systemRow}>
            <View style={[styles.systemPill, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.systemText, { color: colors.textMuted }]}>{item.text}</Text>
            </View>
          </View>
        );
      }
      return (
        <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowOther]}>
          {!isMine && <Avatar name={item.senderName} size="small" />}
          <View
            style={[
              styles.bubble,
              isMine
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.border },
              !isMine && { marginLeft: spacing.sm },
            ]}
          >
            {!isMine && (
              <Text style={[styles.bubbleName, { color: colors.primary }]} numberOfLines={1}>
                {item.senderName}
              </Text>
            )}
            <Text
              style={[
                styles.bubbleText,
                { color: isMine ? '#fff' : colors.text },
              ]}
            >
              {item.text}
            </Text>
          </View>
        </View>
      );
    },
    [colors, currentUser],
  );

  if (!club) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Geri">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Kitap Kulübü</Text>
        </View>
        <EmptyState
          icon="people-outline"
          message="Kulüp bulunamadı"
          description="Bu kulüp silinmiş veya süresi dolmuş olabilir."
          actionLabel="Geri Dön"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const hasAssignments = Object.keys(club.assignments).length > 0;

  // Resolve received book title for a member.
  const receivedFor = (m: ClubMember): ClubMember | undefined =>
    hasAssignments ? club.members.find((x) => x.id === club.assignments[m.id]) : undefined;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
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
          <Ionicons name="people-circle" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {club.name}
          </Text>
        </View>
        <View style={[styles.countPill, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.countText, { color: colors.primary }]}>{club.members.length}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Members grid */}
        <SectionTitle colors={colors}>Üyeler</SectionTitle>
        <View style={styles.grid}>
          {club.members.map((m) => {
            const pastel = pastels[isDark ? 'dark' : 'light'][pastelForName(m.name)];
            const isMe = !!currentUser && m.id === currentUser.id;
            return (
              <View key={m.id} style={styles.gridCell}>
                <View style={[styles.avatarRing, { borderColor: pastel.bg }]}>
                  <Avatar name={m.name} size="medium" />
                </View>
                <Text style={[styles.gridName, { color: colors.text }]} numberOfLines={1}>
                  {m.name}
                </Text>
                {isMe ? (
                  <Text style={[styles.gridSub, { color: colors.primary }]}>Sen</Text>
                ) : (
                  <Text style={[styles.gridSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {m.book.title}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Book pool */}
        <SectionTitle colors={colors}>Kitap Havuzu</SectionTitle>
        <View style={[styles.poolCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
          {club.members.map((m, i) => (
            <View
              key={m.id}
              style={[
                styles.poolRow,
                i < club.members.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
            >
              <Ionicons name="book-outline" size={16} color={colors.primary} style={{ marginRight: spacing.sm }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.poolTitle, { color: colors.text }]} numberOfLines={1}>
                  {m.book.title}
                </Text>
                {m.book.author ? (
                  <Text style={[styles.poolAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                    {m.book.author}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.poolOwner, { color: colors.textMuted }]} numberOfLines={1}>
                {m.name}
              </Text>
            </View>
          ))}
        </View>

        {/* Shuffle + assignments */}
        <View style={styles.shuffleWrap}>
          <Button onPress={handleShuffle} testID="club-shuffle-btn">Karıştır</Button>
        </View>

        {hasAssignments ? (
          <>
            <SectionTitle colors={colors}>Eşleşmeler</SectionTitle>
            <View style={[styles.assignCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.card]}>
              {club.members.map((m, i) => {
                const received = receivedFor(m);
                const isMe = !!currentUser && m.id === currentUser.id;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.assignRow,
                      i < club.members.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={[styles.avatarRing, { borderColor: pastels[isDark ? 'dark' : 'light'][pastelForName(m.name)].bg }]}>
                      <Avatar name={m.name} size="small" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.assignName, { color: colors.text }]} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={[styles.assignBook, { color: isMe ? colors.primary : colors.textMuted }]} numberOfLines={2}>
                        {isMe ? 'Sana ' : ''}
                        <Text style={{ fontWeight: '800', color: isMe ? colors.primary : colors.text }}>
                          {received?.book.title ?? '—'}
                        </Text>
                        {isMe ? ' kaldı!' : ' kaldı.'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Herkese birinin kitabını rastgele dağıtmak için “Karıştır”a dokun.
          </Text>
        )}

        {/* Group chat */}
        <SectionTitle colors={colors}>Kulüp Sohbeti</SectionTitle>
        <View style={[styles.chatBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {messages.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg }]}>
              Henüz mesaj yok. İlk mesajı sen yaz!
            </Text>
          ) : (
            <View style={{ padding: spacing.md, gap: spacing.sm }}>
              {messages.map((m) => (
                <View key={m.id}>{renderMessage({ item: m })}</View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Chat input */}
      <View
        style={[
          styles.inputBar,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.sm, borderTopColor: colors.border },
        ]}
      >
        <View style={[styles.inputWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Mesaj yaz..."
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            testID="club-chat-input"
            accessibilityLabel="Kulüp mesajı yaz"
          />
        </View>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.primary },
            !inputText.trim() && { opacity: 0.4 },
          ]}
          onPress={handleSend}
          disabled={!inputText.trim()}
          accessibilityRole="button"
          accessibilityLabel="Mesaj gönder"
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

const SectionTitle: React.FC<{ children: React.ReactNode; colors: ThemeColors }> = ({
  children,
  colors,
}) => (
  <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{children}</Text>
);

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
  countPill: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  // Body
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
  },
  // Members grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridCell: {
    alignItems: 'center',
    width: 80,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
  },
  gridName: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  gridSub: {
    fontSize: fontSize.caption,
    marginTop: 1,
    textAlign: 'center',
  },
  // Book pool
  poolCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  poolTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  poolAuthor: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  poolOwner: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginLeft: spacing.sm,
    maxWidth: 90,
  },
  // Shuffle
  shuffleWrap: {
    marginTop: spacing.lg,
  },
  // Assignments
  assignCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  assignName: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  assignBook: {
    fontSize: fontSize.bodySm,
    marginTop: 2,
  },
  // Chat
  chatBox: {
    borderRadius: radius.card,
    borderWidth: 1,
    minHeight: 160,
    maxHeight: 320,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  msgRowMine: {
    justifyContent: 'flex-end',
  },
  msgRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bubbleName: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: fontSize.bodySm,
    lineHeight: 19,
  },
  systemRow: {
    alignItems: 'center',
  },
  systemPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  systemText: {
    fontSize: fontSize.caption,
    fontStyle: 'italic',
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 46,
    borderRadius: radius.field,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodySm,
    padding: 0,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.field,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
