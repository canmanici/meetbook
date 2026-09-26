import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapView, Marker } from '@/lib/map-adapter';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
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
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Avatar, Badge, Button, Card, BookCover, SafetySheet, Sheet, Skeleton, TimelineStep, palette, spacing, fontSize, radius } from '@/components/ui';
import { ChipSelect } from '@/components/chip-select';
import { BOOK_CATEGORY_LABELS, BOOK_CONDITION_LABELS } from '@/constants/books';
import { EXCHANGE_STATUS_LABELS } from '@/constants/exchanges';
import { MEETUP_VALIDATION_LABELS } from '@/constants/meetup';
import {
  ApiError,
  authedRequest,
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
 type LocationPrecision } from '@/lib/api/client';
import { buildMapLinks } from '@/lib/maps';
import { SafetyPermissionError, setSafetyPrecision } from '@/lib/safety';
import { listChats } from '@/lib/api/chat';
import { useChatStore } from '@/stores/chat-store';
import { useNerdeyimMode } from '@/hooks/use-nerdeyim-mode';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';

type ReadingBuddyStatus = 'pending' | 'accepted' | 'declined';

type ReadingBuddyView = {
  id: string;
  exchange_id: string;
  user_id: string;
  buddy_id: string;
  chat_id: string | null;
  book_id: string;
  status: ReadingBuddyStatus;
  created_at: string;
};

type ExchangeDetailWithExtras = ExchangeDetail & {
  retired_by?: string | null;
  retired_at?: string | null;
  reading_buddy?: ReadingBuddyView | null;
};

const retireBook = (exchangeId: string) =>
  authedRequest<ExchangeDetailWithExtras>(`/exchanges/${exchangeId}/retire-book`, 'POST', undefined);

const createReadingBuddy = (exchangeId: string) =>
  authedRequest<ReadingBuddyView>(`/exchanges/${exchangeId}/reading-buddy`, 'POST', undefined);

const acceptReadingBuddy = (exchangeId: string) =>
  authedRequest<ReadingBuddyView>(`/exchanges/${exchangeId}/reading-buddy/accept`, 'POST', undefined);

const declineReadingBuddy = (exchangeId: string) =>
  authedRequest<ReadingBuddyView>(`/exchanges/${exchangeId}/reading-buddy/decline`, 'POST', undefined);

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['exchanges', id],
    queryFn: () => getExchange(id),
  });
  const exchange = data as ExchangeDetailWithExtras | undefined;

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
  });

  const { data: chatsData } = useQuery({
    queryKey: ['chats'],
    queryFn: listChats,
  });
  const chatId = chatsData?.items.find((c) => c.exchange_id === id)?.chat_id;
  const sendChatMessage = useChatStore((s) => s.sendMessage);

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
  const [safetyStopAt, setSafetyStopAt] = useState<number | null>(null);
  const [safetyCountdown, setSafetyCountdown] = useState('');
  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>('exact');
  const connectChat = useChatStore((s) => s.connect);

  // T41: post-meetup check-in
  const [checkInDismissed, setCheckInDismissed] = useState(false);
  // T42: meetup countdown + prep checklist
  const [now, setNow] = useState(() => Date.now());
  const [checklist, setChecklist] = useState<boolean[]>([]);

  // Role-specific checklist: items differ for verici (giver) vs alıcı (receiver).
  // Each role gets 3 items so AsyncStorage persistence stays compatible.
  function getChecklistItems(isRequester: boolean): string[] {
    if (isRequester) {
      return [
        'Telefonun şarjı dolu',
        'Güvendiğin birine yerini bildir',
        'Buluşma yerine zamanında git',
      ];
    }
    return [
      'Kitabı hazırla',
      'Kitabın durumunu kontrol et',
      'Güvenli bir yerde buluşmayı unutma',
    ];
  }

  const checklistKey = id ? `@meetbook_checklist_${id}` : null;
  // Compute role-specific items once exchange data is available.
  const checklistItems = exchange ? getChecklistItems(userId === exchange.requested_by) : [];

  // Expanded map modal state
  const [expandedMap, setExpandedMap] = useState<{
    visible: boolean;
    lat: number;
    lng: number;
    place_name: string;
    address?: string;
  }>({ visible: false, lat: 0, lng: 0, place_name: '', address: undefined });

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

  // Nerdeyim Modu — single shared hook (see hooks/use-nerdeyim-mode.ts +
  // stores/location-sharing-store.ts). This used to be a screen-local
  // safetyMode/partnerLocation implementation that duplicated (and drifted
  // out of sync with) the identical logic in chat/[id].tsx.
  const isMeetupConfirmedForLocation = exchange?.status === 'meetup_confirmed';
  const { isSharing: safetyMode, partnerSharing, partnerLocation, start: startNerdeyim, stop: stopNerdeyim } = useNerdeyimMode(
    id,
    isMeetupConfirmedForLocation,
  );

  useEffect(() => {
    if (isMeetupConfirmedForLocation) connectChat();
  }, [isMeetupConfirmedForLocation, connectChat]);

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
        setSafetyStopAt(null);
        stopNerdeyim();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [safetyStopAt, stopNerdeyim]);

  // Load persisted precision preference for this exchange
  useEffect(() => {
    if (!id) return;
    AsyncStorage.getItem(`@meetbook_location_precision_${id}`)
      .then((stored) => {
        if (stored === 'approximate' || stored === 'exact') {
          setLocationPrecision(stored);
          setSafetyPrecision(stored);
        }
      })
      .catch(() => undefined);
  }, [id]);

  const changePrecision = useCallback(
    (precision: LocationPrecision) => {
      setLocationPrecision(precision);
      setSafetyPrecision(precision);
      AsyncStorage.setItem(`@meetbook_location_precision_${id}`, precision).catch(() => undefined);
    },
    [id],
  );

  // T42: countdown timer — tick every second while a meetup is confirmed
  const meetupScheduledAt = exchange?.meetup?.scheduled_at;
  useEffect(() => {
    if (!meetupScheduledAt || exchange?.status !== 'meetup_confirmed') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [meetupScheduledAt, exchange?.status]);

  // T42: load prep checklist from AsyncStorage per exchange
  useEffect(() => {
    if (!checklistKey || !meetupScheduledAt || exchange?.status !== 'meetup_confirmed') return;
    AsyncStorage.getItem(checklistKey)
      .then((stored) => {
        if (!stored) return;
        try {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed) && parsed.length === checklistItems.length) {
            setChecklist(parsed as boolean[]);
          }
        } catch {
          // ignore malformed payload
        }
      })
      .catch(() => undefined);
  }, [checklistKey, meetupScheduledAt, exchange?.status, checklistItems.length]);

  const toggleChecklistItem = useCallback(
    (index: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setChecklist((prev) => {
        const next = prev.map((value, i) => (i === index ? !value : value));
        if (checklistKey) {
          AsyncStorage.setItem(checklistKey, JSON.stringify(next)).catch(() => undefined);
        }
        return next;
      });
    },
    [checklistKey],
  );

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

  // --- B20: Book Retirement Flow ---
  const retireMutation = useMutation({
    mutationFn: () => retireBook(id),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast.show('Kitap emekliliğe ayrıldı', { variant: 'success' });
    },
    onError: () => toast.show('İşlem tamamlanamadı', { variant: 'error' }),
  });

  // --- B24: Reading Buddy Matching ---
  const readingBuddyMutation = useMutation({
    mutationFn: () => createReadingBuddy(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges', id] });
      toast.show('Okuma arkadaşı daveti gönderildi', { variant: 'success' });
    },
    onError: () => toast.show('Davet gönderilemedi', { variant: 'error' }),
  });
  const acceptBuddyMutation = useMutation({
    mutationFn: () => acceptReadingBuddy(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges', id] });
      toast.show('Okuma arkadaşı kabul edildi', { variant: 'success' });
    },
    onError: () => toast.show('İşlem tamamlanamadı', { variant: 'error' }),
  });
  const declineBuddyMutation = useMutation({
    mutationFn: () => declineReadingBuddy(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges', id] });
      toast.show('Okuma arkadaşı daveti reddedildi', { variant: 'success' });
    },
    onError: () => toast.show('İşlem tamamlanamadı', { variant: 'error' }),
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

  const onOpenInMapsForOffer = (provider: 'google' | 'yandex' | 'apple', lat: number, lng: number, place_name: string) => {
    const links = buildMapLinks(lat, lng, place_name);
    Linking.openURL(links[provider]).catch(() => undefined);
  };

  const onOpenExpandedMap = (lat: number, lng: number, place_name: string, address?: string) => {
    setExpandedMap({ visible: true, lat, lng, place_name, address });
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
        await startNerdeyim(new Date(meetup.scheduled_at), locationPrecision);
        // Auto-stop only if meetup is in the future + 30min
        // If meetup is already past, stay on until user toggles off
        const stopAt = new Date(meetup.scheduled_at).getTime() + 30 * 60000;
        setSafetyStopAt(stopAt > Date.now() ? stopAt : null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Surface it in the chat too — otherwise turning this on from the
        // exchange screen (instead of the chat composer button) is invisible
        // to the partner in their Messages list.
        if (chatId) {
          sendChatMessage(chatId, 'Canlı konum paylaşımı başlattı', null, 'location_invite', {
            exchange_id: id,
          });
        }
      } catch (error) {
        setSafetyStopAt(null);
        if (error instanceof SafetyPermissionError) {
          Alert.alert(
            'Arka Plan Konum İzni Gerekli',
            'Güvenlik modunu kullanabilmek için MeetBook\'un her zaman konumunuza erişmesine izin vermelisiniz.\n\nAyarlar > Uygulamalar > MeetBook > Konum bölümünden "Her Zaman" seçeneğini etkinleştirin.',
            [
              { text: 'İptal', style: 'cancel' },
              { text: 'Ayarlara Git', onPress: () => Linking.openSettings() },
            ]
          );
        } else {
          toast.show('Güvenlik modu başlatılamadı', { variant: 'error' });
        }
      }
    } else {
      stopNerdeyim();
      setSafetyStopAt(null);
    }
  };

  const coverUrl = exchange.book.photos?.[0]?.url;

  // T41/T42: time-based derived state for countdown + post-meetup check-in
  const meetupTimeMs = meetup ? new Date(meetup.scheduled_at).getTime() : 0;
  const oneHourAfterMeetupMs = meetupTimeMs + 60 * 60 * 1000;
  const isMeetupConfirmed = exchange.status === 'meetup_confirmed' && !!meetup;
  const showMeetupCountdown = isMeetupConfirmed && now < meetupTimeMs;
  const showPostMeetupCheckIn = isMeetupConfirmed && now >= oneHourAfterMeetupMs && !checkInDismissed;

  const remainingMs = Math.max(0, meetupTimeMs - now);
  const countdownDays = Math.floor(remainingMs / 86400000);
  const countdownHours = Math.floor((remainingMs % 86400000) / 3600000);
  const countdownMinutes = Math.floor((remainingMs % 3600000) / 60000);

  const onCheckInResponse = (response: 'success' | 'neutral' | 'danger') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (response === 'danger') {
      setCheckInDismissed(true);
      setReportSheetVisible(true);
      return;
    }
    if (response === 'success') {
      toast.show('Teşekkürler! Güven puanına katkı sağlandı', { variant: 'success' });
    }
    setCheckInDismissed(true);
  };

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
          <Avatar name={exchange.counterpart.name} imageUrl={(exchange.counterpart as any).avatar_url ?? undefined} size="medium" />
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
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => onOpenExpandedMap(offer.lat, offer.lng, offer.place_name, offer.address ?? undefined)}
                          testID={`meetup-offer-map-expand-${index}`}
                        >
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
                          <View style={[styles.mapExpandOverlay, { backgroundColor: colors.primary + '99' }]}>
                            <Ionicons name="expand-outline" size={16} color="#ffffff" />
                            <Text style={styles.mapExpandText}>Büyüt</Text>
                          </View>
                        </TouchableOpacity>
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
                        <View style={styles.mapsRow}>
                          <TouchableOpacity
                            style={[styles.mapButton, { backgroundColor: colors.background, borderColor: colors.textMuted + '40' }]}
                            onPress={() => onOpenInMapsForOffer('google', offer.lat, offer.lng, offer.place_name)}
                            testID={`meetup-offer-google-maps-${index}`}
                          >
                            <Ionicons name="logo-google" size={14} color={colors.text} />
                            <Text style={[styles.mapButtonText, { color: colors.text }]}>Google</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.mapButton, { backgroundColor: colors.background, borderColor: colors.textMuted + '40' }]}
                            onPress={() => onOpenInMapsForOffer('yandex', offer.lat, offer.lng, offer.place_name)}
                            testID={`meetup-offer-yandex-maps-${index}`}
                          >
                            <Ionicons name="map-outline" size={14} color={colors.text} />
                            <Text style={[styles.mapButtonText, { color: colors.text }]}>Yandex</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.mapButton, { backgroundColor: colors.background, borderColor: colors.textMuted + '40' }]}
                            onPress={() => onOpenInMapsForOffer('apple', offer.lat, offer.lng, offer.place_name)}
                            testID={`meetup-offer-apple-maps-${index}`}
                          >
                            <Ionicons name="logo-apple" size={14} color={colors.text} />
                            <Text style={[styles.mapButtonText, { color: colors.text }]}>Apple</Text>
                          </TouchableOpacity>
                        </View>
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
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => onOpenExpandedMap(meetup.lat, meetup.lng, meetup.place_name, meetup.address ?? undefined)}
                    testID="meetup-place-map-expand"
                  >
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
                      {/* Partner pin renders whenever we HAVE their location —
                          it must not be gated on our own sharing state (that
                          gate was the original "map never appears" bug). */}
                      {partnerLocation && (
                        <Marker
                          coordinate={{
                            latitude: partnerLocation.latitude,
                            longitude: partnerLocation.longitude,
                          }}
                          pinColor="#34C759"
                          testID="partner-location-marker"
                        />
                      )}
                    </MapView>
                    <View style={[styles.mapExpandOverlay, { backgroundColor: colors.primary + '99' }]}>
                      <Ionicons name="expand-outline" size={16} color="#ffffff" />
                      <Text style={styles.mapExpandText}>Büyüt</Text>
                    </View>
                  </TouchableOpacity>
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
                      router.push({
                        pathname: '/meetup/select-place',
                        params: {
                          exchangeId: id,
                          mode: exchange.status === 'meetup_confirmed' ? 'reschedule' : undefined,
                        },
                      })
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

      {/* T42: Meetup countdown + prep checklist */}
      {showMeetupCountdown && (
        <Card
          style={[styles.countdownCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40' }]}
        >
          <View style={styles.countdownHeader}>
            <Ionicons name="time-outline" size={20} color={colors.primary} />
            <Text style={[styles.countdownTitle, { color: colors.primary }]}>Buluşmaya Kalan Süre</Text>
          </View>
          <Text style={[styles.countdownValue, { color: colors.text }]} testID="meetup-countdown-value">
            Buluşmaya {countdownDays} gün {countdownHours} saat {countdownMinutes} dakika
          </Text>

          <View style={[styles.checklistDivider, { backgroundColor: colors.textMuted + '20' }]} />
          <Text style={[styles.checklistTitle, { color: colors.text }]}>Hazırlık Listesi</Text>
          {checklistItems.map((label, index) => {
            const checked = checklist[index];
            return (
              <TouchableOpacity
                key={index}
                onPress={() => toggleChecklistItem(index)}
                style={styles.checklistRow}
                testID={`prep-checklist-item-${index}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={label}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.checklistLabel,
                    { color: checked ? colors.text : colors.textMuted },
                    checked && styles.checklistLabelDone,
                  ]}
                >
                  {checked ? '☑' : '☐'} {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Card>
      )}

      {/* T41: Post-meetup check-in */}
      {showPostMeetupCheckIn && (
        <Card style={styles.checkInCard}>
          <Text style={[styles.checkInTitle, { color: colors.text }]} testID="post-meetup-checkin-card">
            Buluşma nasıl geçti?
          </Text>
          <View style={styles.checkInActions}>
            <TouchableOpacity
              onPress={() => onCheckInResponse('success')}
              style={[styles.checkInButton, { backgroundColor: colors.success }]}
              testID="checkin-success-button"
              accessibilityRole="button"
              accessibilityLabel="Harikaydı"
            >
              <Text style={styles.checkInButtonText}>Harikaydı</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onCheckInResponse('neutral')}
              style={[styles.checkInButton, { backgroundColor: colors.textMuted }]}
              testID="checkin-neutral-button"
              accessibilityRole="button"
              accessibilityLabel="İdare eder"
            >
              <Text style={styles.checkInButtonText}>İdare eder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onCheckInResponse('danger')}
              style={[styles.checkInButton, { backgroundColor: colors.danger }]}
              testID="checkin-danger-button"
              accessibilityRole="button"
              accessibilityLabel="Sorun oldu"
            >
              <Text style={styles.checkInButtonText}>Sorun oldu</Text>
            </TouchableOpacity>
          </View>
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

      {/* Nerdeyim Modu — Live Location Sharing */}
      {meetup && exchange.status === 'meetup_confirmed' && (
        <Card style={[styles.safetyCard, { backgroundColor: colors.info + '10', borderColor: colors.info + '40' }]}>
          {/* Header: icon + title + toggle */}
          <View style={styles.safetyHeader}>
            <View style={[styles.safetyIconWrap, { backgroundColor: colors.info + '30' }]}>
              <Ionicons name="navigate" size={22} color={colors.info} />
            </View>
            <View style={styles.safetyHeaderText}>
              <Text style={[styles.safetyTitle, { color: colors.text }]}>Nerdeyim Modu</Text>
              <Text style={[styles.safetySubtitle, { color: colors.textMuted }]}>
                Karşı tarafa canlı konum gönder
              </Text>
            </View>
            <Switch
              value={safetyMode}
              onValueChange={onToggleSafetyMode}
              trackColor={{ false: colors.textMuted + '40', true: colors.info }}
              thumbColor={safetyMode ? colors.surface : colors.surface}
              testID="safety-mode-toggle"
              accessibilityRole="switch"
              accessibilityLabel="Nerdeyim modu"
            />
          </View>

          {/* Partner is sharing but I'm not yet — prompt to reciprocate */}
          {!safetyMode && partnerSharing && (
            <View style={[styles.safetyReciprocatePanel, { backgroundColor: colors.success + '15', borderColor: colors.success + '30' }]}>
              <View style={styles.safetyReciprocateTextWrap}>
                <Ionicons name="locate" size={16} color={colors.success} />
                <Text style={[styles.safetyReciprocateText, { color: colors.text }]} numberOfLines={2}>
                  {exchange.counterpart.name} canlı konumunu paylaşıyor
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.safetyReciprocateButton, { backgroundColor: colors.success }]}
                onPress={() => onToggleSafetyMode(true)}
                testID="safety-mode-reciprocate-button"
              >
                <Text style={styles.safetyReciprocateButtonText}>Sen de Paylaş</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Active status panel */}
          {safetyMode && (
            <View style={[styles.safetyActivePanel, { backgroundColor: colors.info + '20', borderColor: colors.info + '30' }]}>
              {/* Live broadcasting row */}
              <View style={styles.safetyLiveRow}>
                <View style={styles.safetyLiveDotRow}>
                  <PulseDot color={colors.success} />
                  <Text style={[styles.safetyLiveLabel, { color: colors.text }]}>Canlı yayında</Text>
                </View>
                {safetyCountdown ? (
                  <View style={[styles.safetyChip, { backgroundColor: colors.info + '30' }]}>
                    <Ionicons name="time-outline" size={12} color={colors.info} />
                    <Text style={[styles.safetyChipText, { color: colors.info }]}>{safetyCountdown}</Text>
                  </View>
                ) : null}
              </View>

              {/* Divider */}
              <View style={[styles.safetyDivider, { backgroundColor: colors.info + '20' }]} />

              {/* Partner status */}
              <View style={styles.safetyPartnerRow}>
                <Ionicons
                  name={partnerLocation ? 'locate' : 'locate-outline'}
                  size={16}
                  color={partnerLocation ? colors.success : colors.textMuted}
                />
                <Text
                  style={[
                    styles.safetyPartnerText,
                    { color: partnerLocation ? colors.success : colors.textMuted },
                  ]}
                  numberOfLines={1}
                >
                  {partnerLocation
                    ? `${exchange.counterpart.name} konum paylaşıyor`
                    : `${exchange.counterpart.name} bekleniyor…`}
                </Text>
              </View>

              {/* Last updated timestamp */}
              {partnerLocation?.updated_at && (
                <Text style={[styles.safetyTimestamp, { color: colors.textMuted }]}>
                  Son güncelleme: {new Date(partnerLocation.updated_at).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}

              {/* Divider */}
              <View style={[styles.safetyDivider, { backgroundColor: colors.info + '20' }]} />

              {/* Precision control */}
              <View style={styles.safetyPrecisionRow}>
                <Text style={[styles.safetyPrecisionLabel, { color: colors.textMuted }]}>Hassasiyet</Text>
                <View style={[styles.safetyPrecisionSegment, { backgroundColor: colors.surface }]}>
                  <TouchableOpacity
                    style={[
                      styles.safetyPrecisionOption,
                      locationPrecision === 'exact' && { backgroundColor: colors.info },
                    ]}
                    onPress={() => changePrecision('exact')}
                    testID="location-precision-exact"
                  >
                    <Text
                      style={[
                        styles.safetyPrecisionOptionText,
                        { color: locationPrecision === 'exact' ? '#ffffff' : colors.textMuted },
                      ]}
                    >
                      Hassas
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.safetyPrecisionOption,
                      locationPrecision === 'approximate' && { backgroundColor: colors.info },
                    ]}
                    onPress={() => changePrecision('approximate')}
                    testID="location-precision-approximate"
                  >
                    <Text
                      style={[
                        styles.safetyPrecisionOptionText,
                        { color: locationPrecision === 'approximate' ? '#ffffff' : colors.textMuted },
                      ]}
                    >
                      Yaklaşık
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Explicit stop button — same effect as the header switch, kept
                  here too since it reads clearer than a toggle mid-flow */}
              <TouchableOpacity
                style={[styles.safetyStopButton, { borderColor: colors.danger + '40' }]}
                onPress={() => onToggleSafetyMode(false)}
                testID="safety-mode-stop"
              >
                <Ionicons name="stop-circle-outline" size={16} color={colors.danger} />
                <Text style={[styles.safetyStopButtonText, { color: colors.danger }]}>Paylaşımı Durdur</Text>
              </TouchableOpacity>
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

      {/* B20: Book Retirement Flow */}
      {exchange.status === 'completed' && exchange.mode !== 'borrow' && isRequester && !exchange.retired_at && (
        <Card style={styles.timelineCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Kitabı Emekliliğe Ayır</Text>
          <Text style={[styles.waiting, { color: colors.textMuted }]}>
            Aldığın kitabı artık takasa kapalı olarak işaretle.
          </Text>
          <Button
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              retireMutation.mutate();
            }}
            loading={retireMutation.isPending}
            testID="retire-book-button"
          >
            Emekliliğe Ayır
          </Button>
        </Card>
      )}

      {/* B24: Reading Buddy Matching */}
      {exchange.status === 'completed' && (
        <Card style={styles.timelineCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Okuma Arkadaşı</Text>
          {!exchange.reading_buddy && (
            <>
              <Text style={[styles.waiting, { color: colors.textMuted }]}>
                Bu kitabı birlikte okumak için {exchange.counterpart.name} ile okuma arkadaşı olun.
              </Text>
              <Button
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  readingBuddyMutation.mutate();
                }}
                loading={readingBuddyMutation.isPending}
                testID="create-reading-buddy-button"
              >
                Okuma Arkadaşı Ol
              </Button>
            </>
          )}
          {exchange.reading_buddy?.status === 'pending' && exchange.reading_buddy.user_id === userId && (
            <Text style={[styles.waiting, { color: colors.textMuted }]} testID="reading-buddy-waiting">
              {exchange.counterpart.name} davetini yanıtlıyor.
            </Text>
          )}
          {exchange.reading_buddy?.status === 'pending' && exchange.reading_buddy.buddy_id === userId && (
            <View style={styles.actions}>
              <Button
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  acceptBuddyMutation.mutate();
                }}
                loading={acceptBuddyMutation.isPending}
                testID="accept-reading-buddy-button"
              >
                Kabul Et
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  declineBuddyMutation.mutate();
                }}
                loading={declineBuddyMutation.isPending}
                testID="decline-reading-buddy-button"
              >
                Reddet
              </Button>
            </View>
          )}
          {exchange.reading_buddy?.status === 'accepted' && (
            <View style={styles.actions}>
              <Text style={[styles.waiting, { color: colors.success }]}>
                {exchange.counterpart.name} ile okuma arkadaşısınız.
              </Text>
              {exchange.reading_buddy.chat_id && (
                <Button
                  variant="secondary"
                  onPress={() => router.push(`/chat/${exchange.id}`)}
                  testID="reading-buddy-chat-button"
                >
                  Mesajlaş
                </Button>
              )}
            </View>
          )}
          {exchange.reading_buddy?.status === 'declined' && (
            <Text style={[styles.waiting, { color: colors.textMuted }]}>
              Okuma arkadaşı daveti reddedildi.
            </Text>
          )}
        </Card>
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

      {/* Full-screen map modal */}
      <Modal
        visible={expandedMap.visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setExpandedMap((prev) => ({ ...prev, visible: false }))}
      >
        <View style={[styles.expandedMapContainer, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.expandedMapHeader, { backgroundColor: colors.surface, borderBottomColor: colors.textMuted + '20' }]}>
            <TouchableOpacity
              onPress={() => setExpandedMap((prev) => ({ ...prev, visible: false }))}
              style={styles.expandedMapCloseButton}
              testID="expanded-map-close"
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.expandedMapHeaderInfo}>
              <Text style={[styles.expandedMapTitle, { color: colors.text }]} numberOfLines={1}>
                {expandedMap.place_name}
              </Text>
              {expandedMap.address ? (
                <Text style={[styles.expandedMapAddress, { color: colors.textMuted }]} numberOfLines={2}>
                  {expandedMap.address}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Full-screen map */}
          <View style={styles.expandedMapBody}>
            <MapView
              style={styles.expandedMapFull}
              region={{
                latitude: expandedMap.lat,
                longitude: expandedMap.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              testID="expanded-map-view"
            >
              <Marker
                coordinate={{ latitude: expandedMap.lat, longitude: expandedMap.lng }}
              />
            </MapView>
          </View>

          {/* Bottom bar: Google Maps + Yandex + Apple */}
          <View style={[styles.expandedMapBottom, { backgroundColor: colors.surface, borderTopColor: colors.textMuted + '20' }]}>
            <Text style={[styles.expandedMapLabel, { color: colors.textMuted }]}>Haritada Aç</Text>
            <View style={styles.expandedMapButtons}>
              <TouchableOpacity
                style={[styles.expandedMapButton, { backgroundColor: colors.primary + '15' }]}
                onPress={() => {
                  const links = buildMapLinks(expandedMap.lat, expandedMap.lng, expandedMap.place_name);
                  Linking.openURL(links.google).catch(() => undefined);
                }}
                testID="expanded-map-google"
                accessibilityRole="button"
                accessibilityLabel="Google Haritalar'da aç"
              >
                <Ionicons name="logo-google" size={20} color={colors.primary} />
                <Text style={[styles.expandedMapButtonText, { color: colors.primary }]}>Google</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.expandedMapButton, { backgroundColor: colors.info + '15' }]}
                onPress={() => {
                  const links = buildMapLinks(expandedMap.lat, expandedMap.lng, expandedMap.place_name);
                  Linking.openURL(links.yandex).catch(() => undefined);
                }}
                testID="expanded-map-yandex"
                accessibilityRole="button"
                accessibilityLabel="Yandex Haritalar'da aç"
              >
                <Ionicons name="map-outline" size={20} color={colors.info} />
                <Text style={[styles.expandedMapButtonText, { color: colors.info }]}>Yandex</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.expandedMapButton, { backgroundColor: colors.text + '15' }]}
                onPress={() => {
                  const links = buildMapLinks(expandedMap.lat, expandedMap.lng, expandedMap.place_name);
                  Linking.openURL(links.apple).catch(() => undefined);
                }}
                testID="expanded-map-apple"
                accessibilityRole="button"
                accessibilityLabel="Apple Haritalar'da aç"
              >
                <Ionicons name="logo-apple" size={20} color={colors.text} />
                <Text style={[styles.expandedMapButtonText, { color: colors.text }]}>Apple</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  mapExpandOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  mapExpandText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  mapButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  expandedMapContainer: {
    flex: 1,
  },
  expandedMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  expandedMapCloseButton: {
    padding: 8,
    marginRight: 12,
  },
  expandedMapHeaderInfo: {
    flex: 1,
  },
  expandedMapTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  expandedMapAddress: {
    fontSize: 13,
    marginTop: 2,
  },
  expandedMapBody: {
    flex: 1,
  },
  expandedMapFull: {
    flex: 1,
  },
  expandedMapBottom: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  expandedMapLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  expandedMapButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  expandedMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
  },
  expandedMapButtonText: {
    fontSize: 14,
    fontWeight: '700',
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
  countdownCard: {
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  countdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countdownTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  countdownValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  checklistDivider: {
    height: 1,
    marginVertical: spacing.sm,
  },
  checklistTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checklistLabel: {
    fontSize: fontSize.body,
    flex: 1,
  },
  checklistLabelDone: {
    textDecorationLine: 'line-through',
  },
  checkInCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  checkInTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  checkInActions: {
    gap: spacing.sm,
  },
  checkInButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  checkInButtonText: {
    color: '#ffffff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },

  // Nerdeyim Modu — polished styles
  safetyCard: {
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.md,
    borderRadius: radius.card,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  safetyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyHeaderText: {
    flex: 1,
    gap: 2,
  },
  safetyTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  safetySubtitle: {
    fontSize: fontSize.bodySm,
  },
  safetyActivePanel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  safetyLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  safetyLiveDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  safetyLiveLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  safetyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  safetyChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  safetyDivider: {
    height: 1,
  },
  safetyPartnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  safetyPartnerText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    flex: 1,
  },
  safetyTimestamp: {
    fontSize: fontSize.caption,
    marginTop: -2,
    paddingLeft: 24,
  },
  safetyPrecisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  safetyPrecisionLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  safetyPrecisionSegment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 2,
  },
  safetyPrecisionOption: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  safetyPrecisionOptionText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  safetyStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  safetyStopButtonText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  safetyReciprocatePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  safetyReciprocateTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  safetyReciprocateText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    flex: 1,
  },
  safetyReciprocateButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  safetyReciprocateButtonText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: '#ffffff',
  },
});


// ---------------------------------------------------------------------------
// Nerdeyim Modu — animated live indicator dot
// ---------------------------------------------------------------------------
function PulseDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}
