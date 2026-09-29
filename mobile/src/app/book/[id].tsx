import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';

import { ChipSelect } from '@/components/chip-select';
import {
  BookCover,
  BookJourney,
  Button,
  InlineError,
  Input,
  palette,
  Skeleton,
  spacing,
  fontSize,
  radius,
  shadows,
  TrustBadge,
} from '@/components/ui';
import {
  BOOK_CATEGORIES,
  BOOK_CATEGORY_LABELS,
  BOOK_CONDITIONS,
  BOOK_CONDITION_LABELS,
  BOOK_LANGUAGES,
  BOOK_LANGUAGE_LABELS,
  type BookCategory,
  type BookCondition,
} from '@/constants/books';
import { addFavorite, ApiError, createExchange, deleteBook, getBook, incrementBookView, listExchanges, lookupISBN, removeFavorite, searchNearbyBooks, updateBook } from '@/lib/api/client';
import { getWallet } from '@/lib/api/credits';
import { normalizeCourseCode } from '@/lib/course-code';
import { apiErrorDetail, exchangeRequestError } from '@/lib/exchange-errors';
import { formatDistance } from '@/lib/format';
import { DatePicker } from '@/components/ui/date-time-picker';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';
import { useBookDraftStore } from '@/stores/book-draft-store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const queryClient = useQueryClient();
  const toast = useToast();
  const galleryRef = useRef<ScrollView>(null);
  const formInitialized = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books', id] }),
        queryClient.invalidateQueries({ queryKey: ['exchanges', 'received'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, id]);

  const pickedLocation = useBookDraftStore((state) => state.pickedLocation);
  const clearPickedLocation = useBookDraftStore((state) => state.clearPickedLocation);
  const scannedISBN = useBookDraftStore((state) => state.scannedISBN);
  const clearScannedISBN = useBookDraftStore((state) => state.clearScannedISBN);

  const { data: book, isLoading, error: loadError } = useQuery({
    queryKey: ['books', id],
    queryFn: () => getBook(id),
  });

  const user = useAuthStore((state) => state.user);
  const isOwner = !!book && !!user && book.owner_id === user.id;

  const { data: similarBooks } = useQuery({
    queryKey: ['books', 'similar', book?.id],
    queryFn: () => searchNearbyBooks({ category: book!.category, limit: 5 }),
    enabled: !!book && !isOwner,
    select: (data) => data.items.filter((b) => b.id !== id),
  });

  const { data: ownerBooks } = useQuery({
    queryKey: ['books', 'owner', book?.owner_id],
    queryFn: () => searchNearbyBooks({ owner_id: book!.owner_id, limit: 10 }),
    enabled: !!book && !isOwner,
    select: (data) => data.items.filter((b) => b.id !== id),
  });

  // Balance shown next to the request form ("this book costs 1 credit").
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: getWallet,
    enabled: !!book && !isOwner && book.is_available,
  });

  const [editing, setEditing] = useState(false);
  const { edit: editParam } = useLocalSearchParams<{ edit?: string }>();

  useEffect(() => {
    if (editParam === '1' && isOwner) {
      setEditing(true);
    }
  }, [editParam, isOwner]);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<BookCategory>('fiction');
  const [language, setLanguage] = useState('tr');
  const [condition, setCondition] = useState<BookCondition>('good');
  const [isAvailable, setIsAvailable] = useState(true);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  // Sync favorite state when book data arrives
  useEffect(() => {
    if (book) {
      setIsFavorite(!!(book as any).is_favorited);
    }
  }, [book]);

  const favoriteMutation = useMutation({
    mutationFn: async () => {
      if (isFavorite) {
        await removeFavorite(id);
      } else {
        await addFavorite(id);
      }
    },
    onSuccess: async () => {
      setIsFavorite(!isFavorite);
      await queryClient.invalidateQueries({ queryKey: ['books', id] });
    },
  });

  // Increment view count when non-owner views the page
  useEffect(() => {
    if (book?.id && !isOwner) {
      incrementBookView(id).catch(() => {});
    }
  }, [book?.id, id, isOwner]);

  const pendingRequests = useQuery({
    queryKey: ['exchanges', 'received', id],
    queryFn: () => listExchanges({ role: 'received' }),
    enabled: isOwner,
    select: (data) => ({
      ...data,
      items: data.items.filter((item: any) => item.book?.id === id),
    }),
  }).data;

  useEffect(() => {
    if (editing && !formInitialized.current) {
      formInitialized.current = true;
      if (book) {
        setTitle(book.title || '');
        setAuthor(book.author ?? '');
        setIsbn(book.isbn ?? '');
        setDescription(book.description ?? '');
        setCategory(book.category);
        setLanguage(book.language);
        setCondition(book.condition);
        setIsAvailable(book.is_available);
        // Only the owner view carries the exact location (the edit form is owner-only).
        if ('location' in book) setLocation(book.location);
      }
    }
    if (!editing) {
      formInitialized.current = false;
    }
  }, [editing, book, isOwner]);

  useEffect(() => {
    if (pickedLocation) {
      setLocation(pickedLocation);
      clearPickedLocation();
    }
  }, [pickedLocation, clearPickedLocation]);

  useEffect(() => {
    if (scannedISBN && editing) {
      setIsbn(scannedISBN);
      handleISBNLookup(scannedISBN);
      clearScannedISBN();
    }
  }, [scannedISBN, editing, clearScannedISBN]);

  const handleISBNLookup = async (isbnCode: string) => {
    try {
      const result = await lookupISBN(isbnCode);
      if (result.title) setTitle(result.title);
      if (result.author) setAuthor(result.author);
      if (result.description) setDescription(result.description);
    } catch {
      // Silently fail - user can fill manually
    }
  };

  const onSave = async () => {
    if (!location) {
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);
    setSaving(true);
    try {
      await updateBook(id, {
        title: title.trim(),
        author: author.trim() || null,
        isbn: isbn.trim() || null,
        description: description.trim() || null,
        category,
        language,
        condition,
        is_available: isAvailable,
        location,
      });
      await queryClient.invalidateQueries({ queryKey: ['books', id] });
      await queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('Seçilen konum Türkiye sınırları dışında.');
      } else {
        setError('Bir şeyler ters gitti. Lütfen tekrar deneyin.');
      }
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (force: boolean = false) => {
    try {
      await deleteBook(id, force || undefined);
      await queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !force) {
        Alert.alert(
          'Aktif talep bulunuyor',
          'Bu kitap için aktif talep veya takas bulunuyor. Talepleri iptal edip kitabı silmek istiyor musun?',
          [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Zorla Sil',
              style: 'destructive',
              onPress: () => doDelete(true),
            },
          ],
        );
      } else {
        Alert.alert('Hata', 'Kitap silinirken bir hata oluştu. Lütfen tekrar deneyin.');
      }
    }
  };

  const onDelete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert('Kitabı sil', 'Bu kitabı silmek istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => doDelete(),
      },
    ]);
  };

  const [requestMessage, setRequestMessage] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestCreditAction, setRequestCreditAction] = useState(false);
  // Exchange mode: permanent trade vs. time-limited borrow.
  const [mode, setMode] = useState<'trade' | 'borrow'>('trade');
  // Quick duration buttons (days) plus a 'manual' option that reveals a date picker.
  const [durationChoice, setDurationChoice] = useState<'7' | '15' | '30' | 'manual'>('15');
  const [manualDueDate, setManualDueDate] = useState<Date | null>(null);

  const loanDurationDays = (() => {
    if (durationChoice !== 'manual') return Number(durationChoice);
    if (!manualDueDate) return null;
    const days = Math.ceil((manualDueDate.getTime() - Date.now()) / 86400000);
    return days >= 1 ? days : null;
  })();

  const requestMutation = useMutation({
    mutationFn: () =>
      createExchange({
        book_id: id,
        initial_message: requestMessage.trim() || 'Merhaba, bu kitapla ilgileniyorum!',
        mode,
        ...(mode === 'borrow' ? { loan_duration_days: loanDurationDays } : {}),
      }),
    onSuccess: async (exchange) => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges', 'sent'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setRequestError(null);
      toast.show(
        mode === 'borrow' ? 'Ödünç isteği gönderildi! 🎉' : 'Takas isteği gönderildi! 🎉',
        { variant: 'success', duration: 4000 },
      );
      router.push(`/exchange/${exchange.id}`);
    },
    onError: (err) => {
      const info = exchangeRequestError(err);
      setRequestError(info.message);
      setRequestCreditAction(info.creditAction);
    },
  });

  const onScrollGallery = (e: { nativeEvent: { contentOffset: { x: number }; contentSize: { width: number } } }) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActivePhotoIndex(index);
  };

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

  if (loadError || !book) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Kitap bulunamadı.</Text>
      </View>
    );
  }

  if (isOwner && editing) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}>
        {'photos' in book && book.photos.length > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.galleryEdit}>
            {book.photos.map((photo) => (
              <Image
                key={photo.id}
                source={{ uri: photo.url }}
                style={styles.galleryImageEdit}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        )}

        <Input label="Başlık" value={title} onChangeText={setTitle} />
        <Input label="Yazar" value={author} onChangeText={setAuthor} />

        <View style={styles.isbnRow}>
          <View style={styles.isbnInput}>
            <Input label="ISBN" value={isbn} onChangeText={setIsbn} />
          </View>
          <Button
            variant="secondary"
            onPress={() => router.push('/book/scan-isbn')}
            style={styles.scanButton}
            testID="scan-isbn-button">
            📷 Tara
          </Button>
        </View>

        <Input label="Açıklama" value={description} onChangeText={setDescription} />

        <ChipSelect
          label="Kategori"
          options={BOOK_CATEGORIES}
          labels={BOOK_CATEGORY_LABELS}
          value={category}
          onChange={setCategory}
          testIDPrefix="category"
        />
        <ChipSelect
          label="Dil"
          options={BOOK_LANGUAGES.map((l) => l.code)}
          labels={BOOK_LANGUAGE_LABELS}
          value={language}
          onChange={setLanguage}
          testIDPrefix="language"
        />
        <ChipSelect
          label="Durum"
          options={BOOK_CONDITIONS}
          labels={BOOK_CONDITION_LABELS}
          value={condition}
          onChange={setCondition}
          testIDPrefix="condition"
        />
        <ChipSelect
          label="Müsaitlik"
          options={['available', 'unavailable'] as const}
          labels={{ available: 'Müsait', unavailable: 'Müsait değil' }}
          value={isAvailable ? 'available' : 'unavailable'}
          onChange={(value) => setIsAvailable(value === 'available')}
          testIDPrefix="availability"
        />

        <View style={styles.locationSection}>
          <Text style={[styles.locationLabel, { color: colors.text }]}>Konum</Text>
          <Text style={[styles.locationValue, { color: colors.textMuted }]}>
            {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Konum yok'}
          </Text>
          <Button
            variant="secondary"
            onPress={() => router.push('/book/location-picker')}
            testID="pick-location-button">
            Konumu değiştir
          </Button>
        </View>

        {error && <InlineError message={error} />}

        <Button onPress={onSave} loading={saving} testID="save-book-button">
          Kaydet
        </Button>
        <Button variant="ghost" onPress={() => setEditing(false)} testID="cancel-edit-button">
          Vazgeç
        </Button>
      </ScrollView>
    );
  }

  const photos = 'photos' in book ? book.photos : [];
  const year = book.created_at ? new Date(book.created_at).getFullYear() : null;
  const distanceLabel = !isOwner ? formatDistance((book as any).distance_km) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        testID="book-scroll"
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }>
        {/* Photo Gallery */}
        <View style={styles.galleryContainer}>
          {photos.length > 0 ? (
            <ScrollView
              ref={galleryRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScrollGallery}
              scrollEventThrottle={16}
              style={styles.gallery}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.gallerySlide}>
                  <Image
                    source={{ uri: photo.url }}
                    style={styles.galleryImage}
                    resizeMode="cover"
                  />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.gallery, styles.galleryPlaceholder, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="book-outline" size={64} color={colors.textMuted} />
            </View>
          )}

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.galleryGradient}
          />

          {/* Top buttons */}
          <View style={styles.galleryTopButtons}>
            <TouchableOpacity
              style={styles.glassButton}
              onPress={() => router.back()}
              testID="back-button"
              accessibilityRole="button"
              accessibilityLabel="Geri">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={styles.galleryTopRight}>
              {isOwner ? (
                <>
                  <TouchableOpacity
                    style={styles.glassButton}
                    onPress={() => setEditing(true)}
                    testID="gallery-edit-button"
                    accessibilityRole="button"
                    accessibilityLabel="Düzenle">
                    <Ionicons name="pencil" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.glassButton}
                    onPress={onDelete}
                    testID="gallery-delete-button"
                    accessibilityRole="button"
                    accessibilityLabel="Sil">
                    <Ionicons name="trash" size={18} color="#fff" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.glassButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      favoriteMutation.mutate();
                    }}
                    disabled={favoriteMutation.isPending}
                    testID="favorite-button"
                    accessibilityRole="button"
                    accessibilityLabel={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}>
                    <Ionicons
                      name={isFavorite ? 'heart' : 'heart-outline'}
                      size={20}
                      color={isFavorite ? '#FF6B6B' : '#fff'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.glassButton}
                    onPress={() => {
                      const parts = [book.title];
                      if (book.author) parts.push(book.author);
                      Share.share({
                        message: `${parts.join(' — ')} · MeetBook'ta buldum!`,
                      });
                    }}
                    testID="share-button"
                    accessibilityRole="button"
                    accessibilityLabel="Paylaş">
                    <Ionicons name="share-outline" size={20} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {/* Photo counter */}
          {photos.length > 1 && (
            <View style={styles.photoCounter}>
              <Text style={styles.photoCounterText}>
                {activePhotoIndex + 1}/{photos.length}
              </Text>
            </View>
          )}

          {/* Dots indicator */}
          {photos.length > 1 && (
            <View style={styles.dotsContainer}>
              {photos.map((_, index) => (
                <View
                  key={index}
                  style={[styles.dot, index === activePhotoIndex && styles.dotActive]}
                />
              ))}
            </View>
          )}

        </View>

        {/* Book Info Card — overlaps the gallery for depth */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {isOwner && (
            <View style={[styles.availabilityBadge, { backgroundColor: book.is_available ? colors.success + '20' : colors.danger + '20' }]}>
              <Text style={[styles.availabilityText, { color: book.is_available ? colors.success : colors.danger }]}>
                {book.is_available ? '● Müsait' : '● Müsait Değil'}
              </Text>
            </View>
          )}
          <View style={styles.infoHeader}>
            <View style={styles.infoHeaderLeft}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>{book.title}</Text>
              {book.author ? (
                <Text style={[styles.infoAuthor, { color: colors.textMuted }]}>
                  {book.author}
                  {year ? ` · ${year}` : ''}
                </Text>
              ) : year ? (
                <Text style={[styles.infoAuthor, { color: colors.textMuted }]}>
                  {year}
                </Text>
              ) : null}
            </View>
            {distanceLabel && (
              <View style={[styles.distanceBadge, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="location" size={12} color={colors.success} />
                <Text style={[styles.distanceText, { color: colors.success }]}>{distanceLabel}</Text>
              </View>
            )}
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: colors.background }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Durum</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {BOOK_CONDITION_LABELS[book.condition]}
              </Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.background }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Dil</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {BOOK_LANGUAGE_LABELS[book.language] ?? book.language}
              </Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.background }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Kategori</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {BOOK_CATEGORY_LABELS[book.category]}
              </Text>
            </View>
          </View>

          {/* Description */}
          {book.description ? (
            <View style={styles.descriptionSection}>
              <Text style={[styles.descriptionLabel, { color: colors.textMuted }]}>
                Açıklama
              </Text>
              <Text style={[styles.descriptionText, { color: colors.text }]}>
                {book.description}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Yakınındaki Benzer Kitaplar */}
        {!isOwner && similarBooks && similarBooks.length > 0 && (
          <View style={[styles.similarSection, { backgroundColor: colors.surface }]}>
            <Text style={[styles.similarTitle, { color: colors.text }]}>
              Yakınındaki Benzer Kitaplar
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarList}
            >
              {similarBooks.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.similarItem}
                  onPress={() => router.push(`/book/${b.id}`)}
                  activeOpacity={0.7}>
                  <BookCover url={b.photos?.[0]?.url} size={80} />
                  <Text
                    style={[styles.similarItemTitle, { color: colors.text }]}
                    numberOfLines={2}>
                    {b.title}
                  </Text>
                  {b.distance_km ? (
                    <Text style={[styles.similarItemDistance, { color: colors.textMuted }]}>
                      {b.distance_km} km
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* {owner_name}'in Diğer Kitapları */}
        {!isOwner && ownerBooks && ownerBooks.length > 0 && (
          <View style={[styles.similarSection, { backgroundColor: colors.surface }]}>
            <Text style={[styles.similarTitle, { color: colors.text }]}>
              {book.owner_name ? `${book.owner_name}'in Diğer Kitapları` : 'Diğer Kitapları'}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarList}
            >
              {ownerBooks.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.similarItem}
                  onPress={() => router.push(`/book/${b.id}`)}
                  activeOpacity={0.7}>
                  <BookCover url={b.photos?.[0]?.url} size={80} />
                  <Text
                    style={[styles.similarItemTitle, { color: colors.text }]}
                    numberOfLines={2}>
                    {b.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Bu Kitabın Yolculuğu — timeline of past handoffs (non-owners only) */}
        {!isOwner && <BookJourney bookId={id!} />}

          {/* Stats Card — shown to both owner and non-owner now */}
          <View style={[styles.statsCard, { backgroundColor: colors.surface }]}>
            <View style={styles.statsGrid}>
              {isOwner && (
                <View style={styles.statItem}>
                  <Text style={[styles.statNumber, { color: colors.primary }]}>{pendingRequests?.items?.length ?? 0}</Text>
                  <Text style={[styles.statLabel2, { color: colors.textMuted }]}>Talep</Text>
                </View>
              )}
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: colors.accent }]}>{(book as any).view_count ?? 0}</Text>
                <Text style={[styles.statLabel2, { color: colors.textMuted }]}>Görüntülenme</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: colors.success }]}>{(book as any).favorite_count ?? 0}</Text>
                <Text style={[styles.statLabel2, { color: colors.textMuted }]}>Favori</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: colors.info }]}>
                  {Math.floor((Date.now() - new Date(book.created_at).getTime()) / 86400000)}
                </Text>
                <Text style={[styles.statLabel2, { color: colors.textMuted }]}>gün yayında</Text>
              </View>
            </View>
          </View>

        {/* Owner Card */}
        {!isOwner && (
          <View style={[styles.ownerCard, { backgroundColor: colors.surface }]}>
            <View style={styles.ownerInfo}>
              <View style={[styles.ownerAvatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.ownerAvatarText}>
                  {(book.owner_name || book.owner_id).charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.ownerDetails}>
                <Text style={[styles.ownerName, { color: colors.text }]}>
                  {book.owner_name || 'Kitap Sahibi'}
                </Text>
                <Text style={[styles.ownerLabel, { color: colors.textMuted }]}>Kitap Sahibi</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.profileButton, { borderColor: colors.primary }]}
              onPress={() => router.push(`/user/${book.owner_id}`)}
              testID="profile-button"
              accessibilityRole="button"
              accessibilityLabel="Profili görüntüle">
              <Text style={[styles.profileButtonText, { color: colors.primary }]}>Profil</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Owner Actions */}
        {isOwner && (
          <View style={styles.ownerActionsSection}>
            <Button onPress={() => setEditing(true)} testID="edit-book-button">
              Düzenle
            </Button>
            <Button
              variant="secondary"
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                await updateBook(id, { is_available: !book.is_available });
                await queryClient.invalidateQueries({ queryKey: ['books', id] });
              }}
              testID="toggle-availability-button"
            >
              {book.is_available ? 'Müsaitliği Kapat' : 'Müsait Yap'}
            </Button>
            <Button variant="danger" onPress={onDelete} testID="delete-book-button">
              Sil
            </Button>
          </View>
        )}

        {/* Owner Location Section */}
        {isOwner && 'location' in book && book.location && (
          <View style={[styles.locationCard, { backgroundColor: colors.surface }]}>
            <View style={styles.locationCardHeader}>
              <Ionicons name="location" size={18} color={colors.primary} />
              <Text style={[styles.locationCardTitle, { color: colors.text }]}>Konum</Text>
            </View>
            <Text style={[styles.locationCardCoords, { color: colors.textMuted }]}>
              {book.location.lat.toFixed(4)}, {book.location.lng.toFixed(4)}
            </Text>
            <TouchableOpacity
              onPress={() => {
                const url = `https://www.google.com/maps?q=${book.location.lat},${book.location.lng}`;
                Linking.openURL(url);
              }}
              testID="show-on-map-button"
              accessibilityRole="button"
              accessibilityLabel="Haritada göster"
            >
              <Text style={[styles.mapLink, { color: colors.primary }]}>Haritada Göster</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pending Requests */}
        {isOwner && <PendingRequestsSection bookId={id!} colors={colors} queryClient={queryClient} />}

        {/* Request section for non-owners */}
        {!isOwner && book.is_available && (
          <View style={[styles.requestCard, { backgroundColor: colors.surface }]}>
            <ChipSelect
              label="Nasıl almak istersin?"
              options={['trade', 'borrow'] as const}
              labels={{ trade: 'Takas', borrow: 'Ödünç Al' }}
              value={mode}
              onChange={setMode}
              testIDPrefix="exchange-mode"
            />
            {mode === 'borrow' && (
              <>
                <ChipSelect
                  label="Ne kadar süre?"
                  options={['7', '15', '30', 'manual'] as const}
                  labels={{ '7': '1 Hafta', '15': '15 Gün', '30': '1 Ay', manual: 'Tarih Seç' }}
                  value={durationChoice}
                  onChange={setDurationChoice}
                  testIDPrefix="loan-duration"
                />
                {durationChoice === 'manual' && (
                  <DatePicker
                    label="İade tarihi"
                    value={manualDueDate}
                    minimumDate={new Date()}
                    onChange={setManualDueDate}
                  />
                )}
              </>
            )}
            <Text style={[styles.requestTitle, { color: colors.text }]}>
              {mode === 'borrow' ? 'Ödünç Mesajı (opsiyonel)' : 'Takas Mesajı (opsiyonel)'}
            </Text>
            <Input
              label="Mesaj"
              value={requestMessage}
              onChangeText={setRequestMessage}
              placeholder="Merhaba, bu kitapla ilgileniyorum..."
              testID="exchange-message-input"
            />
            {wallet && (
              <Text style={[styles.creditHint, { color: colors.textMuted }]} testID="request-credit-hint">
                {mode === 'borrow'
                  ? `Ödünç için ${wallet.loan_deposit} kredi depozito ayrılır, kitap dönünce geri gelir. Kullanılabilir: ${wallet.available}`
                  : `Bu kitap ${wallet.trade_cost} kredi. Kullanılabilir: ${wallet.available}`}
              </Text>
            )}
            {requestError && <InlineError message={requestError} />}
            {requestError && requestCreditAction && (
              <TouchableOpacity
                onPress={() => router.push('/settings/credits' as any)}
                testID="request-credit-cta"
                accessibilityRole="button"
              >
                <Text style={[styles.mapLink, { color: colors.primary }]}>Kredilerim →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isOwner && !book.is_available && (
          <View style={[styles.unavailableCard, { backgroundColor: colors.surface }]}>
            <Ionicons name="close-circle-outline" size={20} color={colors.warning} />
            <Text style={[styles.unavailableText, { color: colors.warning }]}>
              Bu kitap şu anda müsait değil
            </Text>
          </View>
        )}

        {/* Bottom spacer for sticky button */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky bottom button */}
      {!isOwner && book.is_available && (
        <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.textMuted + '15' }]}>
          <TouchableOpacity
            style={styles.exchangeButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              requestMutation.mutate();
            }}
            disabled={requestMutation.isPending || (mode === 'borrow' && loanDurationDays == null)}
            testID="request-exchange-button"
            accessibilityRole="button"
            accessibilityLabel={mode === 'borrow' ? 'Ödünç iste' : 'Takas iste'}>
            <LinearGradient
              colors={[colors.success, colors.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.exchangeButtonGradient}>
              {requestMutation.isPending ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <Text style={[styles.exchangeButtonText, { color: '#fff' }]}>
                  {mode === 'borrow' ? 'Ödünç İste' : 'Takas İste'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function PendingRequestsSection({ bookId, colors, queryClient }: { bookId: string; colors: any; queryClient: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ['exchanges', 'received', bookId],
    queryFn: () => listExchanges({ role: 'received' }),
    select: (data) => ({
      ...data,
      items: data.items.filter((item: any) => item.book?.id === bookId),
    }),
  });

  const acceptMutation = useMutation({
    mutationFn: (exchangeId: string) => import('@/lib/api/client').then((m) => m.acceptExchange(exchangeId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges'] });
      await queryClient.invalidateQueries({ queryKey: ['books', bookId] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (exchangeId: string) => import('@/lib/api/client').then((m) => m.rejectExchange(exchangeId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchanges'] });
    },
  });

  if (isLoading) return null;
  if (!data?.items?.length) return null;

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} saat önce`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD} gün önce`;
  };

  return (
    <View style={[styles.pendingSection, { backgroundColor: colors.surface }]}>
      <Text style={[styles.pendingTitle, { color: colors.text }]}>Gelen Talepler ({data.items.length})</Text>
      {data.items.map((exchange: any) => {
        const isPending = exchange.status === 'pending';
        return (
          <View key={exchange.id} style={[styles.pendingItem, { borderBottomColor: colors.textMuted + '15' }]}>
            <View style={styles.pendingItemLeft}>
              <View style={[styles.pendingAvatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.pendingAvatarText}>
                  {exchange.sender?.name?.[0] ?? '?'}
                </Text>
              </View>
              <View style={styles.pendingItemInfo}>
                <Text style={[styles.pendingItemName, { color: colors.text }]}>
                  {exchange.counterpart?.name ?? exchange.sender?.name ?? 'Bilinmeyen'}
                </Text>
                <Text style={[styles.pendingItemTime, { color: colors.textMuted }]}>
                  {exchange.mode === 'borrow' ? 'Ödünç' : 'Takas'} · {formatTime(exchange.created_at)}
                </Text>
                {exchange.counterpart?.trust && (
                  <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    <TrustBadge trust={exchange.counterpart.trust} showBorrowCount />
                  </View>
                )}
              </View>
            </View>
            {isPending && (
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  style={[styles.pendingAcceptBtn, { backgroundColor: colors.success + '20' }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    acceptMutation.mutate(exchange.id);
                  }}
                  disabled={acceptMutation.isPending}
                  testID={`accept-exchange-${exchange.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Talebi kabul et"
                >
                  <Ionicons name="checkmark" size={18} color={colors.success} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pendingRejectBtn, { backgroundColor: colors.danger + '20' }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    rejectMutation.mutate(exchange.id);
                  }}
                  disabled={rejectMutation.isPending}
                  testID={`reject-exchange-${exchange.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Talebi reddet"
                >
                  <Ionicons name="close" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            )}
            {!isPending && (
              <TouchableOpacity
                style={[styles.pendingStatusBadge, {
                  backgroundColor: exchange.status === 'accepted' ? colors.success + '20' :
                    exchange.status === 'rejected' ? colors.danger + '20' : colors.info + '20',
                }]}
                onPress={() => router.push(`/exchange/${exchange.id}`)}
                testID={`view-exchange-${exchange.id}`}
                accessibilityRole="button"
                accessibilityLabel="Talebi görüntüle"
              >
                <Text style={[styles.pendingStatusText, {
                  color: exchange.status === 'accepted' ? colors.success :
                    exchange.status === 'rejected' ? colors.danger : colors.info,
                }]}>
                  {exchange.status === 'accepted' ? 'Kabul' :
                    exchange.status === 'rejected' ? 'Reddedildi' :
                    exchange.status === 'completed' ? 'Tamamlandı' : exchange.status}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={
                  exchange.status === 'accepted' ? colors.success :
                    exchange.status === 'rejected' ? colors.danger : colors.info
                } />
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },

  // Photo Gallery
  galleryContainer: {
    height: 300,
    position: 'relative',
    borderBottomLeftRadius: radius.sheet + 8,
    borderBottomRightRadius: radius.sheet + 8,
    overflow: 'hidden',
  },
  gallery: {
    height: 300,
  },
  gallerySlide: {
    width: SCREEN_WIDTH,
    height: 300,
  },
  galleryImage: {
    ...StyleSheet.absoluteFillObject,
  },
  galleryPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  galleryTopButtons: {
    position: 'absolute',
    top: 48,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  galleryTopRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCounter: {
    position: 'absolute',
    top: 96,
    right: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  photoCounterText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 18,
  },
  galleryOverlayInfo: {
    position: 'absolute',
    bottom: 24,
    left: spacing.lg,
    right: spacing.lg,
  },
  galleryTitle: {
    color: '#fff',
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  galleryAuthor: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.body,
    marginTop: 2,
  },
  galleryTags: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  galleryTag: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  galleryTagText: {
    color: '#fff',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },

  // Book Info Card
  infoCard: {
    marginHorizontal: spacing.lg,
    marginTop: -spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    ...shadows.card,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  infoHeaderLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  infoTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  infoAuthor: {
    fontSize: fontSize.body,
    marginTop: 2,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  distanceText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.field,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: fontSize.caption,
    marginBottom: 2,
  },
  statValue: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  descriptionSection: {
    marginTop: spacing.xs,
  },
  descriptionLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  descriptionText: {
    fontSize: fontSize.body,
    lineHeight: 22,
  },

  // Similar books section
  similarSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
  },
  similarTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  similarList: {
    paddingVertical: spacing.xs,
  },
  similarItem: {
    width: 80,
    marginRight: spacing.md,
    gap: spacing.xs,
  },
  similarItemTitle: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: spacing.xs,
  },
  similarItemDistance: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },

  // Owner Card
  ownerCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ownerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ownerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatarText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  ownerDetails: {
    gap: 2,
  },
  ownerName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  ownerLabel: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  ownerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerMetaText: {
    fontSize: fontSize.caption,
  },
  ownerMetaDot: {
    fontSize: fontSize.caption,
  },
  profileButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  profileButtonText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },

  // Owner actions
  ownerActionsSection: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
    gap: spacing.sm,
  },

  // Request section
  requestCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
    gap: spacing.sm,
  },
  requestTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },

  // Unavailable
  unavailableCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  unavailableText: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },

  // Edit mode
  galleryEdit: {
    height: 200,
    marginBottom: spacing.md,
  },
  galleryImageEdit: {
    width: SCREEN_WIDTH,
    height: 200,
  },
  isbnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  isbnInput: {
    flex: 1,
  },
  scanButton: {
    height: 48,
    paddingHorizontal: spacing.md,
  },
  locationSection: {
    marginBottom: spacing.md,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  locationValue: {
    fontSize: 14,
    marginBottom: spacing.sm,
  },

  // Sticky bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
  },
  exchangeButton: {
    borderRadius: radius.button,
    overflow: 'hidden',
  },
  exchangeButtonGradient: {
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  exchangeButtonText: {
    fontSize: fontSize.body,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Availability badge
  availabilityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  availabilityText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },

  // Owner stats card
  statsCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  statLabel2: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },

  // Location card
  locationCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
  },
  locationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  locationCardTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  locationCardCoords: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.sm,
  },
  courseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  courseChipText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  creditHint: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  mapLink: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },

  // Pending requests
  pendingSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
  },
  pendingTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  pendingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  pendingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingAvatarText: {
    color: '#fff',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  pendingItemInfo: {
    flex: 1,
  },
  pendingItemName: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  pendingItemTime: {
    fontSize: fontSize.caption,
    marginTop: 1,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pendingAcceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingRejectBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingStatusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pendingStatusText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
