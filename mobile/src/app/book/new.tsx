import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapView, Marker, type LatLng, type MapPressEvent } from '@/lib/map-adapter';
import * as Location from 'expo-location';


import { ChipSelect } from '@/components/chip-select';
import { PhotoPicker, type Photo } from '@/components/photo-picker';
import { Button, Card, InlineError, Input, palette, spacing, StepProgress } from '@/components/ui';
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
import { ApiError, createBook, lookupISBN, uploadBookPhoto } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';

const STEPS = [
  { label: 'Fotoğraf' },
  { label: 'Kitap' },
  { label: 'Detay' },
  { label: 'Konum' },
];

const ISTANBUL_REGION = {
  latitude: 41.0082,
  longitude: 28.9784,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function NewBookScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const pickedLocation = useBookDraftStore((state) => state.pickedLocation);
  const clearPickedLocation = useBookDraftStore((state) => state.clearPickedLocation);
  const scannedISBN = useBookDraftStore((state) => state.scannedISBN);
  const clearScannedISBN = useBookDraftStore((state) => state.clearScannedISBN);

  const [currentStep, setCurrentStep] = useState(0);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<BookCategory>('fiction');
  const [language, setLanguage] = useState('tr');
  const [condition, setCondition] = useState<BookCondition>('good');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ found: boolean } | null>(null);

  // Map state
  const [marker, setMarker] = useState<LatLng | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const mapRef = useRef<any>(null);

  // Sync picked location from store (if user picks location from separate screen)
  useEffect(() => {
    if (pickedLocation) {
      setMarker({ latitude: pickedLocation.lat, longitude: pickedLocation.lng });
      clearPickedLocation();
    }
  }, [pickedLocation, clearPickedLocation]);

  // Pre-fill location from query params (long-press on map)
  useEffect(() => {
    if (params.lat && params.lng) {
      const lat = parseFloat(params.lat);
      const lng = parseFloat(params.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        setMarker({ latitude: lat, longitude: lng });
      }
    }
  }, [params.lat, params.lng]);

  // Sync scanned ISBN from store
  useEffect(() => {
    if (scannedISBN) {
      setIsbn(scannedISBN);
      handleISBNLookup(scannedISBN);
      clearScannedISBN();
    }
  }, [scannedISBN, clearScannedISBN]);

  const handleISBNLookup = async (isbnCode: string) => {
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const result = await lookupISBN(isbnCode);
      if (result.title) setTitle(result.title);
      if (result.author) setAuthor(result.author);
      if (result.description) setDescription(result.description);
      if (result.cover_url) {
        setPhotos([{ uri: result.cover_url, type: 'image/jpeg' }]);
      }
      setLookupResult({ found: !!(result.title || result.author) });
    } catch {
      setLookupResult({ found: false });
    } finally {
      setLookupLoading(false);
    }
  };

  const useMyLocation = async () => {
    setLocationError(null);
    setLocationLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('Konum izni verilmedi.');
      setLocationLoading(false);
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      setMarker({ latitude, longitude });
      // MapLibre doesn't support animateToRegion on MapView ref directly
    } catch {
      setLocationError('Konum alınamadı.');
    } finally {
      setLocationLoading(false);
    }
  };

  const onMapPress = (event: MapPressEvent) => {
    setMarker(event.nativeEvent.coordinate);
  };

  const canNext = () => {
    switch (currentStep) {
      case 0:
        return photos.length > 0;
      case 1:
        return title.trim().length > 0;
      case 2:
        return true; // All optional except previous steps
      case 3:
        return marker !== null && !loading;
      default:
        return false;
    }
  };

  const canSubmit = canNext();

  const onSubmit = async () => {
    if (!title.trim()) {
      setError('Lütfen kitap adı girin');
      return;
    }
    if (!marker || photos.length === 0) {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const book = await createBook({
        title: title.trim(),
        author: author.trim() || undefined,
        isbn: isbn.trim() || undefined,
        description: description.trim() || undefined,
        category,
        language,
        condition,
        location: { lat: marker.latitude, lng: marker.longitude },
      });

      // Upload photos
      for (const photo of photos) {
        await uploadBookPhoto(book.id, photo.uri, photo.type);
      }

      await queryClient.invalidateQueries({ queryKey: ['books', 'me'] });
      router.replace(`/book/${book.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('Seçilen konum Türkiye sınırları dışında.');
      } else {
        setError('Bir şeyler ters gitti. Lütfen tekrar deneyin.');
      }
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <View style={styles.stepContent}>
            <TouchableOpacity
              onPress={() => router.push('/book/shelf-scan')}
              style={[styles.shelfScanButton, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
              testID="shelf-scan-link">
              <Ionicons name="library-outline" size={22} color={colors.primary} />
              <View style={styles.shelfScanTextWrap}>
                <Text style={[styles.shelfScanTitle, { color: colors.primary }]}>
                  📚 Rafı Tara (Toplu Kitap Ekle)
                </Text>
                <Text style={[styles.shelfScanSubtitle, { color: colors.textMuted }]}>
                  Kitaplıktaki kitapları kamerayla tek tek tarayarak hızlıca ekleyin.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
            <PhotoPicker photos={photos} onPhotosChange={setPhotos} />
            <Card style={{ ...styles.tipCard, backgroundColor: colors.surface }}>
              <Text style={[styles.tipTitle, { color: colors.text }]}>İpucu</Text>
              <Text style={[styles.tipText, { color: colors.textMuted }]}>
                Kitabınızın ön kapağı ve arka kapağı fotoğraflarsanız, daha hızlı takas yapılır.
              </Text>
            </Card>
          </View>
        );
      case 1:
        return (
          <View style={styles.stepContent}>
            <View style={styles.isbnRow}>
              <View style={styles.isbnInput}>
                <Input
                  label="ISBN"
                  placeholder="ISBN (opsiyonel)"
                  value={isbn}
                  onChangeText={setIsbn}
                />
              </View>
              <Button
                variant="secondary"
                onPress={() => router.push('/book/scan-isbn')}
                style={styles.scanButton}
                testID="scan-isbn-button">
                {lookupLoading ? '...' : '📷 Tara'}
              </Button>
            </View>
            <Input label="Başlık" placeholder="Kitabın adı" value={title} onChangeText={setTitle} />
            <Input label="Yazar" placeholder="Yazar (opsiyonel)" value={author} onChangeText={setAuthor} />
            {lookupLoading && (
              <Card style={[styles.lookupCard, { backgroundColor: colors.surface }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.lookupText, { color: colors.textMuted }]}>ISBN aranıyor...</Text>
              </Card>
            )}
            {!lookupLoading && lookupResult?.found && (
              <Card style={[styles.lookupResultCard, { backgroundColor: colors.success + '10', borderColor: colors.success + '30' }]}>
                <View style={styles.lookupResultRow}>
                  {photos[0] && (
                    <Image source={{ uri: photos[0].uri }} style={styles.lookupCover} />
                  )}
                  <View style={styles.lookupResultInfo}>
                    <View style={[styles.lookupBadge, { backgroundColor: colors.success + '20' }]}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={[styles.lookupBadgeText, { color: colors.success }]}>Kitap bulundu!</Text>
                    </View>
                    {title ? <Text style={[styles.lookupTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text> : null}
                    {author ? <Text style={[styles.lookupAuthor, { color: colors.textMuted }]} numberOfLines={1}>{author}</Text> : null}
                  </View>
                </View>
                <TouchableOpacity onPress={() => setLookupResult(null)}>
                  <Text style={[styles.lookupManualLink, { color: colors.primary }]}>Manuel olarak doldur</Text>
                </TouchableOpacity>
              </Card>
            )}
          </View>
        );
      case 2:
        return (
          <View style={styles.stepContent}>
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
            <Input
              label="Açıklama"
              placeholder="Açıklama (opsiyonel)"
              value={description}
              onChangeText={setDescription}
            />
          </View>
        );
      case 3:
        return (
          <View style={styles.stepContent}>
            <View style={styles.mapContainer}>
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={ISTANBUL_REGION}
                onPress={onMapPress}
                testID="location-picker-map">
                {marker && <Marker coordinate={marker} testID="location-picker-marker" />}
              </MapView>
            </View>
            {locationLoading && (
              <Card style={[styles.locationLoadingCard, { backgroundColor: colors.surface }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.locationLoadingText, { color: colors.textMuted }]}>Konum yükleniyor...</Text>
              </Card>
            )}
            {locationError && <InlineError message={locationError} />}
            <Button
              variant="secondary"
              onPress={useMyLocation}
              disabled={locationLoading}
              testID="use-my-location-button">
              {'Konumum'}
            </Button>
            <Card style={{ ...styles.privacyCard, backgroundColor: colors.surface }}>
              <Text style={[styles.privacyText, { color: colors.textMuted }]}>
                Konumunuz sadece kitabınızın yaklaşık konumunu göstermek için kullanılır.
              </Text>
            </Card>
            {error && <InlineError message={error} />}
            <Button
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={loading}
              testID="submit-book-button">
              Kitabı Yayınla
            </Button>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}>
      <StepProgress steps={STEPS} currentStep={currentStep} />

      {renderStep()}

      <View style={styles.navigation}>
        {currentStep > 0 && (
          <Button
            variant="secondary"
            onPress={() => setCurrentStep((prev) => prev - 1)}
            style={styles.navButton}
            testID="back-button">
            Geri
          </Button>
        )}
        {currentStep < STEPS.length - 1 && (
          <Button
            onPress={() => setCurrentStep((prev) => prev + 1)}
            disabled={!canNext()}
            style={{ ...styles.navButton, ...(currentStep === 0 ? styles.fullWidth : {}) }}
            testID="next-button">
            İleri
          </Button>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  stepContent: {
    gap: spacing.md,
  },
  navigation: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  navButton: {
    flex: 1,
  },
  fullWidth: {
    flex: 1,
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
  tipCard: {
    padding: spacing.md,
    borderRadius: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
  },
  lookupCard: {
    padding: spacing.md,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lookupText: {
    fontSize: 13,
  },
  lookupResultCard: {
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
  },
  lookupResultRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  lookupCover: {
    width: 48,
    height: 64,
    borderRadius: 4,
  },
  lookupResultInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  lookupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  lookupBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  lookupTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  lookupAuthor: {
    fontSize: 13,
  },
  lookupManualLink: {
    fontSize: 13,
    textAlign: 'center',
  },
  mapContainer: {
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  map: {
    flex: 1,
  },
  locationLoadingCard: {
    padding: spacing.md,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationLoadingText: {
    fontSize: 13,
  },
  privacyCard: {
    padding: spacing.md,
    borderRadius: 8,
  },
  privacyText: {
    fontSize: 12,
    lineHeight: 16,
  },
  shelfScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  shelfScanTextWrap: {
    flex: 1,
    gap: 2,
  },
  shelfScanTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  shelfScanSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});