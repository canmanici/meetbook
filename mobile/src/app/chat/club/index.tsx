import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import type { ThemeColors } from '@/components/ui/tokens';
import { useToast } from '@/hooks/use-toast';
import {
  acceptClubInvite,
  clubErrorMessage,
  declineClubInvite,
  listClubs,
  type ClubSummary,
} from '@/lib/api/clubs';
import { ApiError } from '@/lib/api/client';

export default function ClubListScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['clubs'],
    queryFn: listClubs,
  });

  // Refresh on focus so a club created/left elsewhere shows up immediately.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const respond = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }): Promise<void> => {
      if (accept) await acceptClubInvite(id);
      else await declineClubInvite(id);
    },
    onSuccess: (_d, { id, accept }) => {
      queryClient.invalidateQueries({ queryKey: ['clubs'] });
      if (accept) router.push(`/chat/club/${id}`);
      else toast.show('Davet reddedildi', { variant: 'info' });
    },
    onError: (e) => toast.show(clubErrorMessage(e instanceof ApiError ? (e.body as any)?.detail : null), { variant: 'error' }),
  });

  const items = data?.items ?? [];
  const invites = items.filter((c) => c.my_status === 'invited');
  const clubs = items.filter((c) => c.my_status === 'active');

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kitap Kulüplerim</Text>
        <TouchableOpacity
          onPress={() => router.push('/chat/club/create')}
          style={styles.addButton}
          testID="club-create-button"
        >
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <EmptyState
            message="Kulüpler yüklenemedi"
            description="Bağlantını kontrol edip tekrar dene."
            actionLabel="Tekrar dene"
            onAction={() => refetch()}
            icon="cloud-offline-outline"
          />
        ) : items.length === 0 ? (
          <EmptyState
            message="Henüz bir kitap kulübün yok"
            description="Arkadaşlarınla kitap değiş tokuşu yapacağınız bir kulüp oluştur"
            actionLabel="Kulüp Oluştur"
            onAction={() => router.push('/chat/club/create')}
            icon="people-outline"
          />
        ) : (
          <>
            {invites.length > 0 && (
              <Text style={[styles.section, { color: colors.textMuted }]}>Davetler</Text>
            )}
            {invites.map((c) => (
              <View key={c.id} style={[styles.row, { backgroundColor: colors.surface }, shadows.card]} testID={`club-invite-${c.id}`}>
                <View style={[styles.iconWrap, { backgroundColor: colors.warning + '22' }]}>
                  <Ionicons name="mail-unread" size={18} color={colors.warning} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.rowDate, { color: colors.textMuted }]} numberOfLines={1}>
                    {c.owner_name} seni davet etti · {c.active_count} üye
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => respond.mutate({ id: c.id, accept: false })}
                  style={[styles.pillBtn, { borderColor: colors.border }]}
                  disabled={respond.isPending}
                  testID={`club-decline-${c.id}`}
                >
                  <Text style={[styles.pillText, { color: colors.textMuted }]}>Reddet</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => respond.mutate({ id: c.id, accept: true })}
                  style={[styles.pillBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  disabled={respond.isPending}
                  testID={`club-accept-${c.id}`}
                >
                  <Text style={[styles.pillText, { color: '#fff' }]}>Katıl</Text>
                </TouchableOpacity>
              </View>
            ))}

            {clubs.length > 0 && invites.length > 0 && (
              <Text style={[styles.section, { color: colors.textMuted }]}>Kulüplerim</Text>
            )}
            {clubs.map((c) => (
              <ClubRow key={c.id} club={c} colors={colors} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ClubRow({ club, colors }: { club: ClubSummary; colors: ThemeColors }) {
  const last = club.last_message;
  const preview = last
    ? last.sender_id
      ? `${last.sender_name ?? ''}: ${last.text}`
      : last.text
    : `${club.active_count} üye${club.invited_count ? ` · ${club.invited_count} davet bekliyor` : ''}`;
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.surface }, shadows.card]}
      onPress={() => router.push(`/chat/club/${club.id}`)}
      testID={`club-row-${club.id}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
        <Ionicons name={club.shuffled_at ? 'shuffle' : 'people'} size={20} color={colors.primary} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{club.name}</Text>
        <Text style={[styles.rowDate, { color: colors.textMuted }]} numberOfLines={1}>{preview}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  addButton: { padding: spacing.xs },
  headerBorder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1 },
  headerTitle: { flex: 1, fontSize: fontSize.heading, fontWeight: '700' },
  scrollContent: { padding: spacing.lg, gap: spacing.sm },
  section: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.body, fontWeight: '600' },
  rowDate: { fontSize: fontSize.caption },
  pillBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontSize: fontSize.caption, fontWeight: '800' },
});
