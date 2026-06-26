import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { MapView, Marker } from '@/lib/map-adapter';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';

import * as ImagePicker from 'expo-image-picker';

import { Avatar, Badge, Button, Card, BookCover, SafetySheet, Sheet, Skeleton, TimelineStep, TrustBadge, palette, spacing, fontSize, radius } from '@/components/ui';
import { ChipSelect } from '@/components/chip-select';
import { BOOK_CATEGORY_LABELS, BOOK_CONDITION_LABELS } from '@/constants/books';
import { EXCHANGE_STATUS_LABELS, EXCHANGE_STATUS_VARIANTS } from '@/constants/exchanges';
import { MEETUP_VALIDATION_LABELS } from '@/constants/meetup';
import {
  ApiError,
  acceptExchange,
  acceptMeetup,
  blockUser,
  cancelExchange,
  completeExchange,
  confirmExchangeCompletion,
  createRating,
  createReport,
  getExchange,
  getMe,
  rejectExchange,
  rejectMeetup,
  lendExchange,
  returnExchange,
  confirmExchangeReturn,
  requestExchangeExtension,
  approveExchangeExtension,
  rejectExchangeExtension,
  uploadLoanPhoto,
  type ExchangeDetail,
} from '@/lib/api/client';
import { buildMapLinks } from '@/lib/maps';
import { startSafetyMode, stopSafetyMode } from '@/lib/safety';
import { useToast } from '@/hooks/use-toast';
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
  const toast = useToast();
  const userId = useAuthStore((state) => state.user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const { data: exchange, isLoading, error } = useQuery({
    queryKey: ['exchanges', id],
    queryFn: () => getExchange(id),
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['exchanges', id] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, id]);

  const [meetupSafetySheetVisible, setMeetupSafetySheetVisible] = useState(false);
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [rateSheetVisible, setRateSheetVisible] = useState(false);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [safetyMode, setSafetyMode] = useState(false);
  const [safetyStopAt, setSafetyStopAt] = useState<number | null>(null);
  const [safetyCountdown, setSafetyCountdown] = useState('');

  const invalidate = async (updated: ExchangeDetail) => {
    queryClient.setQueryData(['exchanges', id], updated);
    await queryClient.invalidateQueries({ queryKey: ['exchanges', 'sent'] });
    await queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] });
  };

  const acceptMutation = useMutation({
    mutationFn: () => acceptExchange(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Talep kabul edildi', { variant: 'success' });
    },
    onError: () => toast.show('Talep kabul edilemedi', { variant: 'error' }),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectExchange(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Talep reddedildi', { variant: 'success' });
    },
    onError: () => toast.show('Talep reddedilemedi', { variant: 'error' }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelExchange(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Takas iptal edildi', { variant: 'success' });
    },
    onError: () => toast.show('Takas iptal edilemedi', { variant: 'error' }),
  });
  const completeMutation = useMutation({
    mutationFn: () => completeExchange(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Takas tamamlandı', { variant: 'success' });
    },
    onError: () => toast.show('Takas tamamlanamadı', { variant: 'error' }),
  });
  const confirmMutation = useMutation({
    mutationFn: () => confirmExchangeCompletion(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Tamamlandı onaylandı', { variant: 'success' });
    },
    onError: () => toast.show('Onay gönderilemedi', { variant: 'error' }),
  });

  // --- Borrow / lending lifecycle ---
  const [extensionDays, setExtensionDays] = useState<'7' | '15' | '30'>('7');

  // Capture a photo (camera) and upload it; returns the stored URL or null if cancelled.
  const captureLoanPhoto = async (): Promise<string | null> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.show('Fotoğraf çekmek için kamera izni gerekiyor', { variant: 'error' });
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    const uploaded = await uploadLoanPhoto(id, asset.uri, asset.mimeType || 'image/jpeg');
    return uploaded.url;
  };

  const lendMutation = useMutation({
    mutationFn: async () => {
      const photoUrl = await captureLoanPhoto();
      if (!photoUrl) throw new Error('PHOTO_REQUIRED');
      return lendExchange(id, photoUrl);
    },
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Teslim edildi', { variant: 'success' });
    },
    onError: (err) => {
      if ((err as Error).message !== 'PHOTO_REQUIRED') {
        toast.show('İşlem tamamlanamadı. Lütfen tekrar deneyin.', { variant: 'error' });
      }
    },
  });
  const returnMutation = useMutation({
    mutationFn: async () => {
      const photoUrl = await captureLoanPhoto();
      if (!photoUrl) throw new Error('PHOTO_REQUIRED');
      return returnExchange(id, photoUrl);
    },
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('İade bildirildi', { variant: 'success' });
    },
    onError: (err) => {
      if ((err as Error).message !== 'PHOTO_REQUIRED') {
        toast.show('İşlem tamamlanamadı. Lütfen tekrar deneyin.', { variant: 'error' });
      }
    },
  });
  const confirmReturnMutation = useMutation({
    mutationFn: () => confirmExchangeReturn(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('İade onaylandı', { variant: 'success' });
    },
    onError: () => toast.show('İade onaylanamadı', { variant: 'error' }),
  });
  const requestExtensionMutation = useMutation({
    mutationFn: () => requestExchangeExtension(id, Number(extensionDays)),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Uzatma isteği gönderildi', { variant: 'success' });
    },
    onError: () => toast.show('Uzatma isteği gönderilemedi', { variant: 'error' }),
  });
  const approveExtensionMutation = useMutation({
    mutationFn: () => approveExchangeExtension(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Uzatma onaylandı', { variant: 'success' });
    },
    onError: () => toast.show('Uzatma onaylanamadı', { variant: 'error' }),
  });
  const rejectExtensionMutation = useMutation({
    mutationFn: () => rejectExchangeExtension(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Uzatma reddedildi', { variant: 'success' });
    },
    onError: () => toast.show('Uzatma reddedilemedi', { variant: 'error' }),
  });

  const [selectedOfferIndex, setSelectedOfferIndex] = useState(0);

  useEffect(() => {
    setSelectedOfferIndex(0);
  }, [exchange?.meetup?.proposed_by, exchange?.meetup?.updated_at]);

  useEffect(() => {
    if (!safetyStopAt) {
      setSafetyCountdown('');
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, safetyStopAt - Date.now());
      const totalSeconds = Math.floor(remaining / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setSafetyCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      if (remaining <= 0) {
        setSafetyMode(false);
        setSafetyStopAt(null);
        stopSafetyMode();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [safetyStopAt]);

  const acceptMeetupMutation = useMutation({
    mutationFn: ({ offerIndex, acknowledgeWarning }: { offerIndex: number; acknowledgeWarning: boolean }) =>
      acceptMeetup(id, { offer_index: offerIndex, acknowledge_warning: acknowledgeWarning }),
    onSuccess: async (updated) => {
      setMeetupSafetySheetVisible(false);
      await invalidate(updated);
      toast.show('Buluşma onaylandı', { variant: 'success' });
    },
    onError: () => toast.show('Buluşma onaylanamadı', { variant: 'error' }),
  });
  const rejectMeetupMutation = useMutation({
    mutationFn: () => rejectMeetup(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Buluşma reddedildi', { variant: 'success' });
    },
    onError: () => toast.show('Buluşma reddedilemedi', { variant: 'error' }),
  });

  const blockMutation = useMutation({
    mutationFn: (counterpartId: string) => blockUser({ user_id: counterpartId }),
    onSuccess: () => {
      toast.show('Kullanıcı engellendi', { variant: 'success' });
      router.back();
    },
    onError: () => {
      toast.show('Kullanıcı engellenemedi', { variant: 'error' });
    },
  });

  const reportMutation = useMutation({
    mutationFn: () => createReport({ target_type: 'user', target_id: exchange!.counterpart.id, reason: reportReason }),
    onSuccess: () => {
      setReportSheetVisible(false);
      setReportReason('');
      toast.show('Bildirim alındı', { variant: 'success' });
    },
    onError: () => {
      toast.show('Bildirim gönderilemedi', { variant: 'error' });
    },
  });

  const ratingMutation = useMutation({
    mutationFn: () => createRating({ exchange_id: id, score: ratingScore, comment: ratingComment || undefined }),
    onSuccess: () => {
      setRateSheetVisible(false);
      setRatingComment('');
      setRatingScore(5);
      toast.show('Değerlendirmeniz kaydedildi', { variant: 'success' });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        const detail = (err.body as { detail?: string })?.detail;
        if (detail === 'ALREADY_RATED') {
          setRateSheetVisible(false);
          toast.show('Bu takası daha önce değerlendirdiniz', { variant: 'error' });
          return;
        }
      }
      toast.show('Değerlendirme gönderilemedi', { variant: 'error' });
    },
  });

  if (isLoading) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: spacing.md }}
      >
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </ScrollView>
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

  const chosenOffer = meetup?.offers[selectedOfferIndex];

  const meetupHistory = meetup
    ? [...meetup.offers].sort(
        (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(),
      )
    : [];
  const meetupProposerName = meetup
    ? meetup.proposed_by === userId
      ? me?.name ?? 'Sen'
      : exchange.counterpart.name
    : '';

  const onAcceptMeetup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const requiresAck =
      chosenOffer?.validation_status === 'warning' &&
      !(meetup?.proposer_acknowledged && meetup?.other_acknowledged);
    if (requiresAck) {
      setMeetupSafetySheetVisible(true);
      return;
    }
    acceptMeetupMutation.mutate({ offerIndex: selectedOfferIndex, acknowledgeWarning: false });
  };

  const onAcknowledgeMeetupSafety = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    acceptMeetupMutation.mutate({ offerIndex: selectedOfferIndex, acknowledgeWarning: true });
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

  const onToggleSafetyMode = async (enabled: boolean) => {
    if (!meetup) return;
    if (enabled) {
      try {
        await startSafetyMode(id, new Date(meetup.scheduled_at));
        const stopAt = new Date(meetup.scheduled_at).getTime() + 30 * 60000;
        setSafetyStopAt(stopAt);
        setSafetyMode(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        setSafetyMode(false);
        setSafetyStopAt(null);
        toast.show('Arka plan konum izni reddedildi', { variant: 'error' });
      }
    } else {
      stopSafetyMode();
      setSafetyMode(false);
      setSafetyStopAt(null);
    }
  };

  const coverUrl = exchange.book.photos?.[0]?.url;

  return (
    <ScrollView
      testID="exchange-scroll"
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      {/* Book + Counterpart Card */}
      <Card style={styles.bookCounterpartCard}>
        <View style={styles.bookRow}>
          <View style={styles.coverContainer}>
            <BookCover url={coverUrl} size={64} />
          </View>
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
          <View style={styles.counterpartActions}>
            <TouchableOpacity
              onPress={() => setReportSheetVisible(true)}
              style={styles.counterpartActionButton}
              testID="report-user-button"
              accessibilityRole="button"
              accessibilityLabel="Kullanıcıyı bildir"
            >
              <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                Alert.alert(
                  'Kullanıcıyı Engelle',
                  'Bu kullanıcıyı engellemek istiyor musunuz? Bloklanmış kullanıcılar sizi göremez ve kitapları sizden gizlenir.',
                  [
                    { text: 'İptal', style: 'cancel' },
                    {
                      text: 'Engelle',
                      style: 'destructive',
                      onPress: () => blockMutation.mutate(exchange.counterpart.id),
                    },
                  ],
                );
              }}
              style={styles.counterpartActionButton}
              testID="block-user-button"
              accessibilityRole="button"
              accessibilityLabel="Kullanıcıyı engelle"
            >
              <Ionicons name="ban-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
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

      {/* Chat Button (only after exchange is accepted) */}
      {exchange.status !== 'pending' &&
        exchange.status !== 'rejected' &&
        exchange.status !== 'cancelled' &&
        exchange.status !== 'expired' && (
        <Card style={styles.chatCard}>
          <TouchableOpacity
            style={[styles.chatButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push(`/chat/${exchange.id}`)}
            testID="chat-button"
            accessibilityRole="button"
            accessibilityLabel="Mesaj gönder"
          >
            <Ionicons name="chatbubble" size={20} color="#ffffff" />
            <Text style={styles.chatButtonText}>Mesaj Gönder</Text>
          </TouchableOpacity>
        </Card>
      )}

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
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              acceptMutation.mutate();
            }}
            disabled={pending}
            testID="accept-button"
            accessibilityRole="button"
            accessibilityLabel="Talebi kabul et"
          >
            {acceptMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>Onayla</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rejectButton, { borderColor: colors.danger }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              rejectMutation.mutate();
            }}
            disabled={pending}
            testID="reject-button"
            accessibilityRole="button"
            accessibilityLabel="Talebi reddet"
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
              {exchange.status === 'meetup_proposed' ? (
                <View style={styles.offersList}>
                  {!isMeetupProposer && meetup.offers.length > 1 && (
                    <Text style={[styles.offersHint, { color: colors.textMuted }]}>
                      Önerilen seçeneklerden birini seçin
                    </Text>
                  )}
                  {meetup.offers.map((offer, index) => {
                    const isChosen = !isMeetupProposer && selectedOfferIndex === index;
                    return (
                      <TouchableOpacity
                        key={index}
                        activeOpacity={isMeetupProposer ? 1 : 0.7}
                        disabled={isMeetupProposer}
                        onPress={() => setSelectedOfferIndex(index)}
                        style={[
                          styles.placeCard,
                          {
                            backgroundColor: colors.background,
                            borderColor: isChosen ? colors.primary : colors.textMuted + '30',
                            borderWidth: isChosen ? 2 : 1,
                          },
                        ]}
                        testID={`meetup-offer-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Buluşma seçeneği: ${offer.place_name}`}
                      >
                        <View style={styles.placeHeader}>
                          <Ionicons
                            name={isChosen ? 'radio-button-on' : 'location'}
                            size={20}
                            color={colors.primary}
                          />
                          <Text style={[styles.placeName, { color: colors.text }]} testID={`meetup-offer-name-${index}`}>
                            {offer.place_name}
                          </Text>
                        </View>
                        <MapView
                          style={styles.placeMap}
                          pointerEvents="none"
                          region={{
                            latitude: offer.lat,
                            longitude: offer.lng,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                          }}
                          testID={`meetup-offer-map-${index}`}
                        >
                          <Marker coordinate={{ latitude: offer.lat, longitude: offer.lng }} />
                        </MapView>
                        {offer.address ? (
                          <Text style={[styles.placeAddress, { color: colors.textMuted }]}>
                            {offer.address}
                          </Text>
                        ) : null}
                        {offer.category ? (
                          <Badge text={offer.category} variant="info" />
                        ) : null}
                        <Text style={[styles.placeTime, { color: colors.text }]} testID={`meetup-offer-time-${index}`}>
                          {formatDate(offer.scheduled_at)}
                        </Text>
                        <Badge
                          text={MEETUP_VALIDATION_LABELS[offer.validation_status]}
                          variant={offer.validation_status === 'auto' ? 'success' : 'warning'}
                          testID={`meetup-offer-validation-${index}`}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.placeCard, { backgroundColor: colors.background, borderColor: colors.textMuted + '30' }]}>
                  <View style={styles.placeHeader}>
                    <Ionicons name="location" size={20} color={colors.primary} />
                    <Text style={[styles.placeName, { color: colors.text }]} testID="meetup-place-name">
                      {meetup.place_name}
                    </Text>
                  </View>
                  <MapView
                    style={styles.placeMap}
                    pointerEvents="none"
                    region={{
                      latitude: meetup.lat,
                      longitude: meetup.lng,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }}
                    testID="meetup-place-map"
                  >
                    <Marker coordinate={{ latitude: meetup.lat, longitude: meetup.lng }} />
                  </MapView>
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
              )}

              {exchange.status === 'meetup_proposed' && isMeetupProposer && (
                <Text style={[styles.waiting, { color: colors.textMuted }]} testID="meetup-waiting">
                  Karşı tarafın onayı bekleniyor.
                </Text>
              )}

              {exchange.status === 'meetup_proposed' && !isMeetupProposer && (
                <View style={styles.meetupActions}>
                  <TouchableOpacity
                    style={[styles.acceptButton, { backgroundColor: colors.primary }]}
                    onPress={onAcceptMeetup}
                    disabled={meetupPending}
                    testID="accept-meetup-button"
                    accessibilityRole="button"
                    accessibilityLabel="Buluşmayı onayla"
                  >
                    {meetupPending ? (
                      <ActivityIndicator color={colors.surface} />
                    ) : (
                      <Text style={[styles.acceptButtonText, { color: colors.surface }]}>Buluşmayı Onayla</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rejectButton, { borderColor: colors.danger }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      rejectMeetupMutation.mutate();
                    }}
                    disabled={meetupPending}
                    testID="reject-meetup-button"
                    accessibilityRole="button"
                    accessibilityLabel="Buluşmayı reddet"
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
                    {exchange.status === 'meetup_proposed' && !isMeetupProposer
                      ? 'Karşı Öner'
                      : 'Yeniden Planla'}
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
              <>
                {isOwner ? (
                  <>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>Buluşma Yeri Öner</Text>
                    <Text style={[styles.waiting, { color: colors.textMuted }]}>
                      Takas kabul edildi. Lütfen buluşma yeri ve saati önerin.
                    </Text>
                    <Button
                      onPress={() => router.push({ pathname: '/meetup/select-place', params: { exchangeId: id } })}
                      testID="propose-meetup-link-button"
                    >
                      Buluşma Yeri Öner
                    </Button>
                  </>
                ) : (
                  <>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>Buluşma Bekleniyor</Text>
                    <Text style={[styles.waiting, { color: colors.textMuted }]}>
                      Karşı taraf buluşma yeri ve saati önerecek.
                    </Text>
                  </>
                )}
              </>
            )
          )}
        </Card>
      )}

      {/* Meetup Offer History */}
      {meetupHistory.length > 0 && (
        <Card style={styles.historyCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Teklif Geçmişi</Text>
          {meetupHistory.map((offer, i) => (
            <View
              key={i}
              style={[styles.historyRow, { borderColor: colors.textMuted + '20' }]}
              testID={`meetup-history-row-${i}`}
            >
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text
                style={[styles.historyText, { color: colors.text }]}
                numberOfLines={1}
              >
                {meetupProposerName} • {offer.place_name}
              </Text>
              <Text style={[styles.historyDate, { color: colors.textMuted }]}>
                {formatDate(offer.scheduled_at)}
              </Text>
              <Badge
                text={MEETUP_VALIDATION_LABELS[offer.validation_status]}
                variant={
                  offer.validation_status === 'auto'
                    ? 'success'
                    : offer.validation_status === 'rejected'
                      ? 'danger'
                      : 'warning'
                }
                testID={`meetup-history-badge-${i}`}
              />
            </View>
          ))}
        </Card>
      )}

      {/* Security Tip Card */}
      <Card style={[styles.securityCard, { backgroundColor: colors.success + '10', borderColor: colors.success + '40' }]}>
        <View style={styles.securityHeader}>
          <Ionicons name="shield-checkmark" size={20} color={colors.success} />
          <Text style={[styles.securityTitle, { color: colors.success }]}>Güvenlik İpucu</Text>
        </View>
        <Text style={[styles.securityText, { color: colors.textMuted }]}>
          Buluşma için her zaman kalabalık ve güvenli kamusal alanları tercih edin.
          Tanımadığınız kişilerle yalnız başına buluşmaktan kaçının.
        </Text>
      </Card>

      {/* Share with Trusted Contact */}
      {meetup && (exchange.status === 'meetup_confirmed' || exchange.status === 'meetup_proposed') && (
        <TouchableOpacity
          style={[styles.shareButton, { backgroundColor: colors.info }]}
          onPress={onShareWithTrustedContact}
          testID="share-trusted-contact-button"
          accessibilityRole="button"
          accessibilityLabel="Güvenilir kişiyle paylaş"
        >
          <Ionicons name="share-social" size={18} color={colors.surface} />
          <Text style={[styles.shareButtonText, { color: colors.surface }]}>Güvenilir Kişiyle Paylaş</Text>
        </TouchableOpacity>
      )}

      {/* Safety Companion Mode */}
      {meetup && exchange.status === 'meetup_confirmed' && (
        <Card
          style={[styles.safetyCard, { backgroundColor: colors.info + '10', borderColor: colors.info + '40' }]}
        >
          <View style={styles.safetyToggleRow}>
            <View style={styles.safetyToggleInfo}>
              <Text style={[styles.safetyTitle, { color: colors.text }]}>Güvenlik Modu</Text>
              <Text style={[styles.safetyDescription, { color: colors.textMuted }]}>
                Buluşma süresince konumunuzu güvenilir kişinizle paylaşın.
              </Text>
            </View>
            <Switch
              value={safetyMode}
              onValueChange={onToggleSafetyMode}
              trackColor={{ false: colors.textMuted + '40', true: colors.info }}
              thumbColor={safetyMode ? colors.surface : colors.surface}
              testID="safety-mode-toggle"
              accessibilityRole="switch"
              accessibilityLabel="Güvenlik modu"
            />
          </View>
          {safetyMode && (
            <View style={[styles.safetyBadgeRow, { backgroundColor: colors.info + '20' }]}>
              <Text style={[styles.safetyBadge, { color: colors.info }]} testID="safety-mode-badge">
                🛡️ Güvenlik modu aktif
              </Text>
              {safetyCountdown ? (
                <Text style={[styles.safetyCountdown, { color: colors.info }]}>
                  Otomatik durma: {safetyCountdown}
                </Text>
              ) : null}
            </View>
          )}
        </Card>
      )}

      {/* Completion Actions (trade mode) */}
      {exchange.status === 'accepted' && exchange.mode !== 'borrow' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              completeMutation.mutate();
            }}
            disabled={pending}
            testID="complete-button"
            accessibilityRole="button"
            accessibilityLabel="Takası tamamla"
          >
            {completeMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>Takası Tamamla</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* --- Borrow / lending lifecycle --- */}
      {exchange.mode === 'borrow' && (exchange.status === 'lent' || exchange.status === 'return_pending' || exchange.status === 'overdue') && exchange.due_at && (
        <Card style={styles.timelineCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Ödünç Durumu</Text>
          <Badge
            variant={exchange.status === 'overdue' ? 'danger' : 'primary'}
            text={renderDueLabel(exchange.due_at, exchange.status)}
          />
        </Card>
      )}

      {/* Hand-over: at confirmed meetup, either party marks the book lent (photo required) */}
      {exchange.mode === 'borrow' && exchange.status === 'meetup_confirmed' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              lendMutation.mutate();
            }}
            disabled={lendMutation.isPending}
            testID="lend-button"
            accessibilityRole="button"
            accessibilityLabel="Teslim edildi"
          >
            {lendMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>Teslim Edildi (Fotoğraf Çek)</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Borrower returns the book (photo required) */}
      {exchange.mode === 'borrow' && (exchange.status === 'lent' || exchange.status === 'overdue') && isRequester && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              returnMutation.mutate();
            }}
            disabled={returnMutation.isPending}
            testID="return-button"
            accessibilityRole="button"
            accessibilityLabel="İade et"
          >
            {returnMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>İade Ettim (Fotoğraf Çek)</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Owner confirms the returned book */}
      {exchange.mode === 'borrow' && exchange.status === 'return_pending' && isOwner && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              confirmReturnMutation.mutate();
            }}
            disabled={confirmReturnMutation.isPending}
            testID="confirm-return-button"
            accessibilityRole="button"
            accessibilityLabel="İadeyi onayla"
          >
            {confirmReturnMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>İadeyi Onayla</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {exchange.mode === 'borrow' && exchange.status === 'return_pending' && isRequester && (
        <Text style={[styles.waiting, { color: colors.textMuted }]}>
          Kitap sahibinin iade onayı bekleniyor.
        </Text>
      )}

      {/* Extension request (borrower) while on loan */}
      {exchange.mode === 'borrow' && (exchange.status === 'lent' || exchange.status === 'overdue') && isRequester && (
        <Card style={styles.timelineCard}>
          {exchange.extension_status === 'pending' ? (
            <Text style={[styles.waiting, { color: colors.textMuted }]}>
              Süre uzatma isteğin onay bekliyor ({exchange.extension_requested_days} gün).
            </Text>
          ) : (
            <>
              <ChipSelect
                label="Süre uzatma iste"
                options={['7', '15', '30'] as const}
                labels={{ '7': '1 Hafta', '15': '15 Gün', '30': '1 Ay' }}
                value={extensionDays}
                onChange={setExtensionDays}
                testIDPrefix="extension-days"
              />
              <Button
                variant="secondary"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  requestExtensionMutation.mutate();
                }}
                loading={requestExtensionMutation.isPending}
                testID="request-extension-button"
              >
                Uzatma İste
              </Button>
            </>
          )}
        </Card>
      )}

      {/* Extension decision (owner) */}
      {exchange.mode === 'borrow' && exchange.extension_status === 'pending' && isOwner && (exchange.status === 'lent' || exchange.status === 'overdue') && (
        <Card style={styles.timelineCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Süre uzatma isteği: {exchange.extension_requested_days} gün
          </Text>
          <View style={styles.actions}>
            <Button
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                approveExtensionMutation.mutate();
              }}
              loading={approveExtensionMutation.isPending}
              testID="approve-extension-button"
            >
              Onayla
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                rejectExtensionMutation.mutate();
              }}
              loading={rejectExtensionMutation.isPending}
              testID="reject-extension-button"
            >
              Reddet
            </Button>
          </View>
        </Card>
      )}

      {exchange.status === 'completed' && (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            onPress={() => setRateSheetVisible(true)}
            testID="rate-exchange-button"
          >
            {`${exchange.counterpart.name} İçin Değerlendirme Yap`}
          </Button>
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
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              confirmMutation.mutate();
            }}
            disabled={pending}
            testID="confirm-completion-button"
            accessibilityRole="button"
            accessibilityLabel="Tamamlandığını onayla"
          >
            {confirmMutation.isPending ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.acceptButtonText, { color: colors.surface }]}>Tamamlandığını Onayla</Text>
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
        <View style={[styles.cancelZone, { borderColor: colors.danger }]}>
          <Text style={[styles.cancelZoneTitle, { color: colors.danger }]}>İptal</Text>
          <Text style={[styles.cancelZoneText, { color: colors.textMuted }]}>
            Bu işlem geri alınamaz.
          </Text>
          <TouchableOpacity
            style={[styles.cancelButton, { borderColor: colors.danger }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              cancelMutation.mutate();
            }}
            disabled={pending}
            testID="cancel-button"
            accessibilityRole="button"
            accessibilityLabel="İptal et"
          >
            {cancelMutation.isPending ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={[styles.cancelButtonText, { color: colors.danger }]}>
                {exchange.status === 'pending' && isRequester ? 'Talebi İptal Et' : 'İptal Et'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Button variant="ghost" onPress={() => router.back()} testID="back-button">
        Geri
      </Button>

      <Sheet
        visible={reportSheetVisible}
        onClose={() => setReportSheetVisible(false)}
        title="Kullanıcıyı Bildir"
      >
        <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>
          Bu kullanıcıyla ilgili sorununuzu açıklayın.
        </Text>
        <TextInput
          style={[styles.reportInput, { borderColor: colors.textMuted + '40', color: colors.text }]}
          placeholder="Sebep açıklayın..."
          placeholderTextColor={colors.textMuted}
          value={reportReason}
          onChangeText={setReportReason}
          multiline
          numberOfLines={4}
          testID="report-reason-input"
        />
        <Button
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            reportMutation.mutate();
          }}
          disabled={reportReason.trim().length === 0}
          loading={reportMutation.isPending}
          testID="submit-report-button"
        >
          Gönder
        </Button>
      </Sheet>

      <Sheet
        visible={rateSheetVisible}
        onClose={() => setRateSheetVisible(false)}
        title="Değerlendirme Yap"
      >
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => setRatingScore(value)}
              testID={`rating-star-${value}`}
              accessibilityRole="button"
              accessibilityLabel={`${value} yıldız`}
            >
              <Ionicons
                name={value <= ratingScore ? 'star' : 'star-outline'}
                size={32}
                color={colors.primary}
              />
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={[styles.reportInput, { borderColor: colors.textMuted + '40', color: colors.text }]}
          placeholder="Yorumunuz (opsiyonel)"
          placeholderTextColor={colors.textMuted}
          value={ratingComment}
          onChangeText={setRatingComment}
          multiline
          numberOfLines={4}
          testID="rating-comment-input"
        />
        <Button
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            ratingMutation.mutate();
          }}
          loading={ratingMutation.isPending}
          testID="submit-rating-button"
        >
          Gönder
        </Button>
      </Sheet>
    </ScrollView>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('tr-TR');
}

function renderDueLabel(dueAt: string, status: string): string {
  const due = new Date(dueAt);
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  const dateStr = due.toLocaleDateString('tr-TR');
  if (status === 'overdue' || days < 0) {
    return `Gecikmiş · ${Math.abs(days)} gün geçti (${dateStr})`;
  }
  if (days === 0) return `Son gün bugün (${dateStr})`;
  return `${days} gün kaldı · son tarih ${dateStr}`;
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
  counterpartActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  counterpartActionButton: {
    padding: spacing.xs,
  },
  sheetLabel: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.sm,
  },
  reportInput: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: spacing.sm,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
    fontSize: fontSize.body,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
  chatCard: {
    padding: spacing.md,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    gap: spacing.xs,
  },
  chatButtonText: {
    color: '#ffffff',
    fontSize: fontSize.body,
    fontWeight: '700',
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
  historyCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
  },
  historyText: {
    flex: 1,
    fontSize: fontSize.bodySm,
  },
  historyDate: {
    fontSize: fontSize.caption,
  },
  offersList: {
    gap: spacing.sm,
  },
  offersHint: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
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
  placeMap: {
    width: '100%',
    height: 180,
    borderRadius: 8,
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
  safetyCard: {
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  safetyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  safetyToggleInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  safetyTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  safetyDescription: {
    fontSize: fontSize.bodySm,
    lineHeight: 18,
  },
  safetyBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    gap: spacing.sm,
  },
  safetyBadge: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  safetyCountdown: {
    fontSize: fontSize.caption,
    fontWeight: '600',
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
