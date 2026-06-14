import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import MapView, { Marker, type LatLng, type MapPressEvent } from 'react-native-maps';

import { Button, Input, SafetySheet, fontSize, palette, radius, spacing } from '@/components/ui';
import { SAFE_MEETUP_CATEGORIES } from '@/constants/meetup';
import {
  getMeetupSuggestions,
  placeDetails,
  placesAutocomplete,
  proposeMeetup,
  type MeetupOffer,
  type PlaceSuggestion,
  type PlaceSummary,
} from '@/lib/api/client';

const ISTANBUL_REGION = {
  latitude: 41.0082,
  longitude: 28.9784,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

const MAX_OFFERS = 5;

interface SelectedPlace {
  placeId: string | null;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
}

interface OfferDraft extends SelectedPlace {
  date: string;
  time: string;
}

export default function SelectMeetupPlaceScreen() {
  const { exchangeId } = useLocalSearchParams<{ exchangeId: string }>();
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [offers, setOffers] = useState<OfferDraft[]>([]);
  const [safetySheetVisible, setSafetySheetVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: suggestionsData } = useQuery({
    queryKey: ['meetup-suggestions', exchangeId],
    queryFn: () => getMeetupSuggestions(exchangeId),
    enabled: !!exchangeId,
  });

  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const center = selected ?? ISTANBUL_REGION;
    const handle = setTimeout(async () => {
      try {
        const res = await placesAutocomplete({
          query,
          lat: 'lat' in center ? center.lat : center.latitude,
          lng: 'lng' in center ? center.lng : center.longitude,
        });
        setSuggestions(res.items);
      } catch {
        setSuggestions([]);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query, selected]);

  const onSelectSuggestion = async (item: PlaceSuggestion) => {
    setQuery(item.description);
    setSuggestions([]);
    try {
      const details = await placeDetails(item.place_id);
      if (details) {
        setSelected({
          placeId: details.place_id,
          name: details.name,
          address: details.address,
          category: details.category,
          lat: details.lat,
          lng: details.lng,
        });
      }
    } catch {
      setError('Yer bilgisi alınamadı.');
    }
  };

  const onSelectSuggestedPlace = (place: PlaceSummary) => {
    addOffer({
      placeId: place.place_id,
      name: place.name,
      address: place.address,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
    });
  };

  const onMapPress = (event: MapPressEvent) => {
    const coordinate: LatLng = event.nativeEvent.coordinate;
    setSuggestions([]);
    setSelected({
      placeId: null,
      name: query.trim() || 'Seçilen Konum',
      address: null,
      category: null,
      lat: coordinate.latitude,
      lng: coordinate.longitude,
    });
  };

  const isWarningCategory = (category: string | null) =>
    !category || !(SAFE_MEETUP_CATEGORIES as readonly string[]).includes(category);

  const addOffer = (place: SelectedPlace) => {
    setError(null);
    setOffers((current) => {
      if (current.length >= MAX_OFFERS) {
        setError(`En fazla ${MAX_OFFERS} öneri ekleyebilirsiniz.`);
        return current;
      }
      if (current.some((o) => o.lat === place.lat && o.lng === place.lng)) {
        return current;
      }
      return [...current, { ...place, date, time }];
    });
  };

  const onAddSelectedPlace = () => {
    if (!selected) {
      setError('Lütfen bir buluşma noktası seçin.');
      return;
    }
    addOffer(selected);
    setSelected(null);
    setQuery('');
  };

  const removeOffer = (index: number) => {
    setOffers((current) => current.filter((_, i) => i !== index));
  };

  const updateOffer = (index: number, patch: Partial<OfferDraft>) => {
    setOffers((current) => current.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };

  const proposeMutation = useMutation({
    mutationFn: (acknowledgeWarning: boolean) => {
      const built: MeetupOffer[] = [];
      for (const offer of offers) {
        const scheduledAt = buildScheduledAt(offer.date, offer.time);
        if (!scheduledAt) {
          throw new Error('INVALID_SCHEDULE');
        }
        built.push({
          place_id: offer.placeId,
          place_name: offer.name,
          address: offer.address,
          category: offer.category,
          lat: offer.lat,
          lng: offer.lng,
          scheduled_at: scheduledAt,
        });
      }
      return proposeMeetup(exchangeId, {
        offers: built,
        acknowledge_warning: acknowledgeWarning,
      });
    },
    onSuccess: () => {
      router.back();
    },
    onError: () => {
      setError('Buluşma önerisi gönderilemedi. Bilgileri kontrol edin.');
    },
  });

  const onPropose = () => {
    setError(null);
    if (offers.length === 0) {
      setError('Lütfen en az bir buluşma noktası ekleyin.');
      return;
    }
    for (const offer of offers) {
      if (!buildScheduledAt(offer.date, offer.time)) {
        setError(`"${offer.name}" için geçerli bir tarih ve saat girin.`);
        return;
      }
    }
    if (offers.some((o) => isWarningCategory(o.category))) {
      setSafetySheetVisible(true);
      return;
    }
    proposeMutation.mutate(false);
  };

  const onAcknowledgeSafety = () => {
    setSafetySheetVisible(false);
    proposeMutation.mutate(true);
  };

  const markerCoordinate: LatLng | null = selected
    ? { latitude: selected.lat, longitude: selected.lng }
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <MapView
        style={styles.map}
        initialRegion={ISTANBUL_REGION}
        onPress={onMapPress}
        testID="select-place-map"
      >
        {markerCoordinate && <Marker coordinate={markerCoordinate} testID="select-place-marker" />}
        {offers.map((offer, index) => (
          <Marker
            key={`${offer.lat}-${offer.lng}-${index}`}
            coordinate={{ latitude: offer.lat, longitude: offer.lng }}
            pinColor={colors.primary}
            testID={`offer-marker-${index}`}
          />
        ))}
      </MapView>

      <View style={styles.panel}>
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
          Buluşma için bir veya daha fazla yer önerin (en fazla {MAX_OFFERS})
        </Text>

        <Input
          placeholder="Yer ara..."
          value={query}
          onChangeText={setQuery}
          testID="place-search-input"
        />

        {suggestions.length > 0 && (
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.place_id}
            style={styles.suggestionsList}
            testID="place-suggestions-list"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionRow}
                onPress={() => onSelectSuggestion(item)}
                testID={`place-suggestion-${item.place_id}`}
              >
                <Text style={{ color: colors.text }}>{item.description}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        {selected && (
          <View style={styles.selectedRow}>
            <Text style={[styles.selectedLabel, { color: colors.text }]} testID="selected-place-label">
              Seçilen: {selected.name}
            </Text>
            <Button onPress={onAddSelectedPlace} testID="add-selected-place-button">
              Listeye Ekle
            </Button>
          </View>
        )}

        {suggestionsData && suggestionsData.items.length > 0 && (
          <View style={styles.suggestedPlaces}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              Önerilen Buluşma Noktaları
            </Text>
            <FlatList
              horizontal
              data={suggestionsData.items}
              keyExtractor={(item, index) => item.place_id ?? `${item.name}-${index}`}
              testID="suggested-places-list"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.suggestedCard, { borderColor: colors.primary }]}
                  onPress={() => onSelectSuggestedPlace(item)}
                  testID={`suggested-place-${item.place_id ?? item.name}`}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{item.name}</Text>
                  {item.address ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                      {item.address}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <View style={styles.dateRow}>
          <Input
            label="Varsayılan Tarih (YYYY-AA-GG)"
            placeholder="2026-07-01"
            value={date}
            onChangeText={setDate}
            style={styles.dateInput}
            testID="meetup-date-input"
          />
          <Input
            label="Varsayılan Saat (SS:DD)"
            placeholder="14:00"
            value={time}
            onChangeText={setTime}
            style={styles.dateInput}
            testID="meetup-time-input"
          />
        </View>

        {offers.length > 0 && (
          <View style={styles.offersList}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
              Önerilecek Yerler ve Saatler
            </Text>
            {offers.map((offer, index) => (
              <View
                key={`${offer.lat}-${offer.lng}-${index}`}
                style={[styles.offerCard, { borderColor: colors.textMuted + '30' }]}
                testID={`offer-card-${index}`}
              >
                <View style={styles.offerHeader}>
                  <Text style={[styles.offerName, { color: colors.text }]} numberOfLines={1}>
                    {index + 1}. {offer.name}
                  </Text>
                  <TouchableOpacity onPress={() => removeOffer(index)} testID={`remove-offer-${index}`}>
                    <Text style={{ color: colors.danger, fontWeight: '600' }}>Kaldır</Text>
                  </TouchableOpacity>
                </View>
                {offer.address ? (
                  <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                    {offer.address}
                  </Text>
                ) : null}
                <View style={styles.dateRow}>
                  <Input
                    label="Tarih (YYYY-AA-GG)"
                    placeholder="2026-07-01"
                    value={offer.date}
                    onChangeText={(value) => updateOffer(index, { date: value })}
                    style={styles.dateInput}
                    testID={`offer-date-input-${index}`}
                  />
                  <Input
                    label="Saat (SS:DD)"
                    placeholder="14:00"
                    value={offer.time}
                    onChangeText={(value) => updateOffer(index, { time: value })}
                    style={styles.dateInput}
                    testID={`offer-time-input-${index}`}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} testID="select-place-error">
            {error}
          </Text>
        ) : null}

        <Button
          onPress={onPropose}
          loading={proposeMutation.isPending}
          testID="propose-meetup-button"
        >
          Buluşma Öner
        </Button>
      </View>

      <SafetySheet
        visible={safetySheetVisible}
        onClose={() => setSafetySheetVisible(false)}
        onAcknowledge={onAcknowledgeSafety}
        loading={proposeMutation.isPending}
      />
    </View>
  );
}

function buildScheduledAt(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const isoCandidate = `${date}T${time}:00`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return isoCandidate;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  suggestionsList: {
    maxHeight: 160,
  },
  suggestionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  suggestedPlaces: {
    gap: spacing.xs,
  },
  sectionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  suggestedCard: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: spacing.sm,
    marginRight: spacing.sm,
    minWidth: 160,
  },
  selectedRow: {
    gap: spacing.xs,
  },
  selectedLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  offersList: {
    gap: spacing.sm,
  },
  offerCard: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  offerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  offerName: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    flex: 1,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateInput: {
    flex: 1,
  },
  error: {
    fontSize: fontSize.bodySm,
  },
});
