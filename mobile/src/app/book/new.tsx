import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import MapView, { Marker, type LatLng, type MapPressEvent } from 'react-native-maps';
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

  // Map state
  const [marker, setMarker] = useState<LatLng | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Sync picked location from store (if user picks location from separate screen)
  useEffect(() => {
    if (pickedLocation) {
      setMarker({ latitude: pickedLocation.lat, longitude: pickedLocation.lng });
      clearPickedLocation();
    }
  }, [pickedLocation, clearPickedLocation]);

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
    try {
      const result = await lookupISBN(isbnCode);
      if (result.title) setTitle(result.title);
      if (result.author) setAuthor(result.author);
      if (result.description) setDescription(result.description);
      if (result.cover_url) {
        setPhotos([{ uri: result.cover_url, type: 'image/jpeg' }]);
      }
    } catch {
      // Silently fail - user can fill manually
    } finally {
      setLookupLoading(false);
    }
  };

  const useMyLocation = async () => {
    setLocationError(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('Konum izni verilmedi.');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({});
      setMarker({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      setLocationError('Konum alınamadı.');
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
              <Card style={{ ...styles.lookupCard, backgroundColor: colors.surface }}>
                <Text style={[styles.lookupText, { color: colors.textMuted }]}>ISBN aranıyor...</Text>
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
                style={styles.map}
                initialRegion={ISTANBUL_REGION}
                onPress={onMapPress}
                testID="location-picker-map">
                {marker && <Marker coordinate={marker} testID="location-picker-marker" />}
              </MapView>
            </View>
            {locationError && <InlineError message={locationError} />}
            <Button variant="secondary" onPress={useMyLocation} testID="use-my-location-button">
              Konumum
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
  },
  lookupText: {
    fontSize: 13,
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
  privacyCard: {
    padding: spacing.md,
    borderRadius: 8,
  },
  privacyText: {
    fontSize: 12,
    lineHeight: 16,
  },
});