import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';

import { Avatar, Badge, Button, Card, SafetySheet, TimelineStep, palette, spacing, fontSize } from '@/components/ui';
import { BOOK_CATEGORY_LABELS, BOOK_CONDITION_LABELS } from '@/constants/books';
import { EXCHANGE_STATUS_LABELS, EXCHANGE_STATUS_VARIANTS } from '@/constants/exchanges';
import { MEETUP_VALIDATION_LABELS } from '@/constants/meetup';
import {
  acceptExchange,
  acceptMeetup,
  cancelExchange,
  completeExchange,
  confirmExchangeCompletion,
  getExchange,
  getMe,
  rejectExchange,
  rejectMeetup,
  type ExchangeDetail,
} from '@/lib/api/client';
import { buildMapLinks } from '@/lib/maps';
import { useAuthStore } from '@/stores/auth-store';

type StepStatus = 'done' | 'active' | 'pending';

function getTimelineSteps(
  exchange: ExchangeDetail,
  userId: string | undefined,
): { status: StepStatus; title: string; subtitle: string }[] {
  const s = exchange.status;
  const meetup = exchange.meetup;

  const step1: { status: StepStatus; title: string; subtitle: string } = {
    status: 'done',
    title: 'Talep Gönderildi',
    subtitle: formatDate(exchange.created_at),
  };

  let step2: { status: StepStatus; title: string; subtitle: string };
  if (s === 'rejected' || s === 'cancelled' || s === 'expired') {
    step2 = { status: 'done', title: 'Onay Bekleniyor', subtitle: EXCHANGE_STATUS_LABELS[s] };
  } else if (s === 'pending') {
    step2 = { status: 'active', title: 'Onay Bekleniyor', subtitle: 'Karşı tarafın onayı bekleniyor' };
  } else {
    step2 = { status: 'done', title: 'Onay Bekleniyor', subtitle: 'Kabul edildi' };
  }

  let step3: { status: StepStatus; title: string; subtitle: string };
  if (s === 'completed') {
    step3 = { status: 'done', title: 'Buluşma Belirlenecek', subtitle: 'Tamamlandı' };
  } else if (meetup) {
    step3 = { status: 'done', title: 'Buluşma Belirlenecek', subtitle: meetup.place_name };
  } else if (s === 'accepted') {
    step3 = { status: 'active', title: 'Buluşma Belirlenecek', subtitle: 'Buluşma yeri seçin' };
  } else {
    step3 = { status: 'pending', title: 'Buluşma Belirlenecek', subtitle: '' };
  }

  let step4: { status: StepStatus; title: string; subtitle: string };
  if (s === 'completed' || s === 'meetup_confirmed') {
    step4 = { status: 'done', title: 'Buluşma', subtitle: meetup ? formatDate(meetup.scheduled_at) : '' };
  } else if (s === 'meetup_proposed') {
    step4 = { status: 'active', title: 'Buluşma', subtitle: 'Onay bekleniyor' };
  } else {
    step4 = { status: 'pending', title: 'Buluşma', subtitle: '' };
  }

  let step5: { status: StepStatus; title: string; subtitle: string };
  if (s === 'completed') {
    step5 = { status: 'done', title: 'Tamamlandı', subtitle: formatDate(exchange.updated_at) };
  } else if (s === 'completion_pending') {
    step5 = { status: 'active', title: 'Tamamlandı', subtitle: 'Onay bekleniyor' };
  } else {
    step5 = { status: 'pending', title: 'Tamamlandı', subtitle: '' };
  }

  return [step1, step2, step3, step4, step5];
}

export default function ExchangeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);

  const { data: exchange, isLoading, error } = useQuery({
    queryKey: ['exchanges', id],
    queryFn: () => getExchange(id),
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  const [meetupSafetySheetVisible, setMeetupSafetySheetVisible] = useState(false);

  const invalidate = async (updated: ExchangeDetail) => {
    queryClient.setQueryData(['exchanges', id], updated);
    await queryClient.invalidateQueries({ queryKey: ['exchanges', 'sent'] });
    await queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
  };

  const acceptMutation = useMutation({ mutationFn: () => acceptExchange(id), onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: () => rejectExchange(id), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: () => cancelExchange(id), onSuccess: invalidate });
  const completeMutation = useMutation({
    mutationFn: () => completeExchange(id),
    onSuccess: invalidate,
  });
  const confirmMutation = useMutation({
    mutationFn: () => confirmExchangeCompletion(id),
    onSuccess: invalidate,
  });
  const acceptMeetupMutation = useMutation({
    mutationFn: (acknowledgeWarning: boolean) =>
      acceptMeetup(id, { acknowledge_warning: acknowledgeWarning }),
    onSuccess: (updated) => {
      setMeetupSafetySheetVisible(false);
      return invalidate(updated);
    },
  });
  const rejectMeetupMutation = useMutation({
    mutationFn: () => rejectMeetup(id),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !exchange) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Talep bulunamadı.</Text>
      </View>
    );
  }

  const isRequester = userId === exchange.requested_by;
  const isOwner = userId === exchange.requested_to;
  const pending = acceptMutation.isPending || rejectMutation.isPending || cancelMutation.isPending
    || completeMutation.isPending || confirmMutation.isPending;
  const meetupPending = acceptMeetupMutation.isPending || rejectMeetupMutation.isPending;

  const meetup = exchange.meetup;
  const isMeetupProposer = meetup?.proposed_by === userId;

  const steps = getTimelineSteps(exchange, userId);

  const onAcceptMeetup = () => {
    if (meetup?.requires_acknowledgment) {
      setMeetupSafetySheetVisible(true);
      return;
    }
    acceptMeetupMutation.mutate(false);
  };

  const onAcknowledgeMeetupSafety = () => {
    acceptMeetupMutation.mutate(true);
  };

  const onOpenInMaps = (provider: 'google' | 'yandex' | 'apple') => {
    if (!meetup) return;
    const links = buildMapLinks(meetup.lat, meetup.lng, meetup.place_name);
    Linking.openURL(links[provider]).catch(() => undefined);
  };

  const onCopyAddress = async () => {
    if (!meetup) return;
    await Clipboard.setStringAsync(
      `${meetup.place_name} — ${meetup.address ?? `${meetup.lat}, ${meetup.lng}`}`
    );
  };

  const onShareWithTrustedContact = async () => {
    if (!meetup) return;
    const greeting = me?.trusted_contact_name ? `${me.trusted_contact_name}, ` : '';
    const message =
      `${greeting}${exchange.counterpart.name} ile "${exchange.book.title}" kitabı için ` +
      `${formatDate(meetup.scheduled_at)} tarihinde ${meetup.place_name}` +
      `${meetup.address ? ` (${meetup.address})` : ''} adresinde buluşacağım.`;
    try {
      await Share.share({ message });
    } catch {
      // user dismissed the share sheet
    }
  };

  const coverUrl = exchange.book.photos?.[0]?.url;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Book + Counterpart Card */}
      <Card style={styles.bookCounterpartCard}>
        <View style={styles.bookRow}>
          {coverUrl ? (
            <View style={styles.coverContainer}>
              <Text style={[styles.coverPlaceholder, { color: colors.textMuted }]}>📖</Text>
            </View>
          ) : (
            <View style={[styles.coverContainer, { backgroundColor: colors.textMuted + '20' }]}>
              <Ionicons name="book-outline" size={32} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.bookInfo}>
            <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={2}>
              {exchange.book.title}
            </Text>
            {exchange.book.author ? (
              <Text style={[styles.bookAuthor, { color: colors.textMuted }]} numberOfLines={1}>
                {exchange.book.author}
              </Text>
            ) : null}
            <View style={styles.bookMeta}>
              <Badge text={BOOK_CATEGORY_LABELS[exchange.book.category]} variant="info" />
              <Badge text={BOOK_CONDITION_LABELS[exchange.book.condition]} variant="success" />
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.textMuted + '30' }]} />

        <View style={styles.counterpartRow}>
          <Avatar name={exchange.counterpart.name} size="medium" />
          <View style={styles.counterpartInfo}>
            <Text style={[styles.counterpartLabel, { color: colors.textMuted }]}>
              {isOwner ? 'İsteyen' : 'Sahibi'}
            </Text>
            <Text style={[styles.counterpartName, { color: colors.text }]}>
              {exchange.counterpart.name}
            </Text>
          </View>
        </View>

        {exchange.initial_message ? (
          <>
            <View style={[styles.divider, { backgroundColor: colors.textMuted + '30' }]} />
            <View style={styles.messageSection}>
              <Text style={[styles.messageLabel, { color: colors.textMuted }]}>Mesaj</Text>
              <Text style={[styles.messageText, { color: colors.text }]}>
                {exchange.initial_message}
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      {/* Visual Timeline */}
      <Card style={styles.timelineCard}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Süreç</Text>
        <View style={styles.timelineContainer}>
          {steps.map((step, index) => (
            <TimelineStep
              key={index}
              status={step.status}
              title={step.title}
              subtitle={step.subtitle}
              isLast={index === steps.length - 1}
            />
          ))}
        </View>
      </Card>

      {/* Action Buttons */}
      {exchange.status === 'pending' && isOwner && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: '#0F6E5D' }]}
            onPress={() => acceptMutation.mutate()}
            disabled={pending}
            testID="accept-button"
          >
            {acceptMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.acceptButtonText}>Onayla</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rejectButton, { borderColor: colors.danger }]}
            onPress={() => rejectMutation.mutate()}
            disabled={pending}
            testID="reject-button"
          >
            {rejectMutation.isPending ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={[styles.rejectButtonText, { color: colors.danger }]}>Reddet</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Meetup Section */}
      {(exchange.status === 'accepted' ||
        exchange.status === 'meetup_proposed' ||
        exchange.status === 'meetup_confirmed') && (
        <Card style={styles.meetupCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Buluşma</Text>

          {meetup ? (
            <>
              <View style={[styles.placeCard, { backgroundColor: colors.background, borderColor: colors.textMuted + '30' }]}>
                <View style={styles.placeHeader}>
                  <Ionicons name="location" size={20} color={colors.primary} />
                  <Text style={[styles.placeName, { color: colors.text }]} testID="meetup-place-name">
                    {meetup.place_name}
                  </Text>
                </View>
                {meetup.address ? (
                  <Text style={[styles.placeAddress, { color: colors.textMuted }]}>
                    {meetup.address}
                  </Text>
                ) : null}
                {meetup.category ? (
                  <Badge text={meetup.category} variant="info" />
                ) : null}
                <Text style={[styles.placeTime, { color: colors.text }]} testID="meetup-scheduled-at">
                  {formatDate(meetup.scheduled_at)}
                </Text>
                <Badge
                  text={MEETUP_VALIDATION_LABELS[meetup.validation_status]}
                  variant={meetup.validation_status === 'auto' ? 'success' : 'warning'}
                  testID="meetup-validation-badge"
                />
              </View>

              {exchange.status === 'meetup_proposed' && isMeetupProposer && (
                <Text style={[styles.waiting, { color: colors.textMuted }]} testID="meetup-waiting">
                  Karşı tarafın onayı bekleniyor.
                </Text>
              )}

              {exchange.status === 'meetup_proposed' && !isMeetupProposer && (
                <View style={styles.meetupActions}>
                  <TouchableOpacity
                    style={[styles.acceptButton, { backgroundColor: '#0F6E5D' }]}
                    onPress={onAcceptMeetup}
                    disabled={meetupPending}
                    testID="accept-meetup-button"
                  >
                    {meetupPending ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.acceptButtonText}>Buluşmayı Onayla</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rejectButton, { borderColor: colors.danger }]}
                    onPress={() => rejectMeetupMutation.mutate()}
                    disabled={meetupPending}
                    testID="reject-meetup-button"
                  >
                    {rejectMeetupMutation.isPending ? (
                      <ActivityIndicator color={colors.danger} />
                    ) : (
                      <Text style={[styles.rejectButtonText, { color: colors.danger }]}>Reddet</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {(exchange.status === 'meetup_proposed' || exchange.status === 'meetup_confirmed') && (
                <View style={styles.meetupActions}>
                  <Button
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/meetup/select-place', params: { exchangeId: id } })
                    }
                    testID="reschedule-meetup-button"
                  >
                    Yeniden Planla
                  </Button>
                </View>
              )}

              {exchange.status === 'meetup_confirmed' && (
                <View style={styles.meetupActions}>
                  <View style={styles.mapsRow}>
                    <Button
                      variant="secondary"
                      onPress={() => onOpenInMaps('google')}
                      testID="open-google-maps-button"
                    >
                      Google
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => onOpenInMaps('yandex')}
                      testID="open-yandex-maps-button"
                    >
                      Yandex
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => onOpenInMaps('apple')}
                      testID="open-apple-maps-button"
                    >
                      Apple
                    </Button>
                  </View>
                  <Button
                    variant="ghost"
                    onPress={onCopyAddress}
                    testID="copy-meetup-address-button"
                  >
                    Adresi Kopyala
                  </Button>
                </View>
              )}
            </>
          ) : (
            exchange.status === 'accepted' && (
              <Button
                onPress={() =>
                  router.push({ pathname: '/meetup/select-place', params: { exchangeId: id } })
                }
                testID="propose-meetup-link-button"
              >
                Buluşma Öner
              </Button>
            )
          )}
        </Card>
      )}

      {/* Security Tip Card */}
      <Card style={styles.securityCard}>
        <View style={styles.securityHeader}>
          <Ionicons name="shield-checkmark" size={20} color="#059669" />
          <Text style={[styles.securityTitle, { color: '#065f46' }]}>Güvenlik İpucu</Text>
        </View>
        <Text style={[styles.securityText, { color: '#047857' }]}>
          Buluşma için her zaman kalabalık ve güvenli kamusal alanları tercih edin.
          Tanımadığınız kişilerle yalnız başına buluşmaktan kaçının.
        </Text>
      </Card>

      {/* Share with Trusted Contact */}
      {meetup && (exchange.status === 'meetup_confirmed' || exchange.status === 'meetup_proposed') && (
        <TouchableOpacity
          style={[styles.shareButton, { backgroundColor: '#2563eb' }]}
          onPress={onShareWithTrustedContact}
          testID="share-trusted-contact-button"
        >
          <Ionicons name="share-social" size={18} color="#fff" />
          <Text style={styles.shareButtonText}>Güvenilir Kişiyle Paylaş</Text>
        </TouchableOpacity>
      )}

      {/* Completion Actions */}
      {exchange.status === 'accepted' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: '#0F6E5D' }]}
            onPress={() => completeMutation.mutate()}
            disabled={pending}
            testID="complete-button"
          >
            {completeMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.acceptButtonText}>Takası Tamamla</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {exchange.status === 'completion_pending' && exchange.completion_marked_by === userId && (
        <Text style={[styles.waiting, { color: colors.textMuted }]} testID="waiting-confirmation">
          Diğer kullanıcının onayı bekleniyor.
        </Text>
      )}

      {exchange.status === 'completion_pending' && exchange.completion_marked_by !== userId && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: '#0F6E5D' }]}
            onPress={() => confirmMutation.mutate()}
            disabled={pending}
            testID="confirm-completion-button"
          >
            {confirmMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.acceptButtonText}>Tamamlandığını Onayla</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <SafetySheet
        visible={meetupSafetySheetVisible}
        onClose={() => setMeetupSafetySheetVisible(false)}
        onAcknowledge={onAcknowledgeMeetupSafety}
        loading={acceptMeetupMutation.isPending}
      />

      {/* Cancel Zone */}
      {(exchange.status === 'pending' || exchange.status === 'accepted' || exchange.status === 'completion_pending') && (
        <View style={[styles.cancelZone, { borderColor: '#ef4444' }]}>
          <Text style={[styles.cancelZoneTitle, { color: '#ef4444' }]}>İptal</Text>
          <Text style={[styles.cancelZoneText, { color: colors.textMuted }]}>
            Bu işlem geri alınamaz.
          </Text>
          <TouchableOpacity
            style={[styles.cancelButton, { borderColor: '#ef4444' }]}
            onPress={() => cancelMutation.mutate()}
            disabled={pending}
            testID="cancel-button"
          >
            {cancelMutation.isPending ? (
              <ActivityIndicator color="#ef4444" />
            ) : (
              <Text style={[styles.cancelButtonText, { color: '#ef4444' }]}>
                {exchange.status === 'pending' && isRequester ? 'Talebi İptal Et' : 'İptal Et'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Button variant="ghost" onPress={() => router.back()} testID="back-button">
        Geri
      </Button>
    </ScrollView>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('tr-TR');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  bookCounterpartCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  bookRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  coverContainer: {
    width: 80,
    height: 110,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  coverPlaceholder: {
    fontSize: 32,
  },
  bookInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  bookTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  bookAuthor: {
    fontSize: fontSize.body,
  },
  bookMeta: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  divider: {
    height: 1,
    marginVertical: spacing.xs,
  },
  counterpartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  counterpartInfo: {
    flex: 1,
    gap: 2,
  },
  counterpartLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  counterpartName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  messageSection: {
    gap: spacing.xs,
  },
  messageLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  messageText: {
    fontSize: fontSize.body,
    lineHeight: 20,
  },
  timelineCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  timelineContainer: {
    paddingLeft: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
  },
  acceptButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  rejectButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    minHeight: 48,
  },
  rejectButtonText: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  meetupCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  placeCard: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
  },
  placeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  placeName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    flex: 1,
  },
  placeAddress: {
    fontSize: fontSize.bodySm,
  },
  placeTime: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  meetupActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  mapsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  securityCard: {
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.xs,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  securityTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  securityText: {
    fontSize: fontSize.bodySm,
    lineHeight: 18,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    gap: spacing.xs,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  cancelZone: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  cancelZoneTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  cancelZoneText: {
    fontSize: fontSize.bodySm,
  },
  cancelButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginTop: spacing.xs,
    minHeight: 48,
  },
  cancelButtonText: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  waiting: {
    fontSize: fontSize.body,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
