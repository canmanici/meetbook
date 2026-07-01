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
import { MapView, Marker, type LatLng, type MapPressEvent } from '@/lib/map-adapter';

import { Badge, Button, Input, SafetySheet, fontSize, palette, radius, spacing } from '@/components/ui';
import { DatePicker } from '@/components/ui/date-time-picker';
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

interface WeatherInfo {
  temp: number;
  code: number;
}

export default function SelectMeetupPlaceScreen() {
  const { exchangeId } = useLocalSearchParams<{ exchangeId: string }>();
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [defaultDateTime, setDefaultDateTime] = useState<Date | null>(null);
  const [offers, setOffers] = useState<OfferDraft[]>([]);
  const [safetySheetVisible, setSafetySheetVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [busyHoursOpen, setBusyHoursOpen] = useState(false);

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

  useEffect(() => {
    if (!selected) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    setWeatherLoading(true);
    fetchWeather(selected.lat, selected.lng)
      .then((data) => {
        if (!cancelled) {
          setWeather(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWeather(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWeatherLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

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
      const dateTime = defaultDateTime || new Date();
      return [...current, { 
        ...place, 
        date: dateTime.toISOString().split('T')[0],
        time: dateTime.toTimeString().slice(0, 5)
      }];
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

  const weatherDisplay = weather ? getWeatherDisplay(weather.code) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <MapView
        style={[styles.map, { backgroundColor: colors.background }]}
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
                style={[styles.suggestionRow, { borderBottomColor: colors.border }]}
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
            <View style={styles.selectedPlaceInfo}>
              <Text style={[styles.selectedLabel, { color: colors.text }]} testID="selected-place-label">
                Seçilen: {selected.name}
              </Text>
              {weatherDisplay && weather && (
                <Badge
                  text={`${weatherDisplay.emoji} ${weather.temp}°C`}
                  variant={weatherDisplay.isPrecipitation ? 'warning' : 'info'}
                  testID="weather-badge"
                />
              )}
              {weatherLoading && (
                <Text style={[styles.weatherLoading, { color: colors.textMuted }]} testID="weather-loading">
                  Hava durumu yükleniyor...
                </Text>
              )}
            </View>

            {weatherDisplay?.isPrecipitation && (
              <Text style={[styles.weatherWarning, { color: colors.danger }]} testID="weather-warning">
                Yağış bekleniyor — kapalı mekan seç
              </Text>
            )}

            <TouchableOpacity
              style={styles.busyHoursToggle}
              onPress={() => setBusyHoursOpen((v) => !v)}
              testID="busy-hours-toggle"
            >
              <Text style={[styles.busyHoursTitle, { color: colors.text }]}>
                Kalabalık Saatler
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                {busyHoursOpen ? '▾' : '▸'}
              </Text>
            </TouchableOpacity>

            {busyHoursOpen && (
              <View style={styles.busyHoursContent} testID="busy-hours-content">
                <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                  {getBusyHoursHint(selected.category) ?? 'Kalabalık saat verisi yok'}
                </Text>
              </View>
            )}

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

        <DatePicker
          value={defaultDateTime}
          onChange={setDefaultDateTime}
          label="Varsayılan Tarih ve Saat"
        />

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
                <DatePicker
                  value={new Date(`${offer.date}T${offer.time}`)}
                  onChange={(date) => updateOffer(index, { 
                    date: date.toISOString().split('T')[0],
                    time: date.toTimeString().slice(0, 5)
                  })}
                  label="Tarih ve Saat"
                />
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
  const isoCandidate = `${date}T${time}:00`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return isoCandidate;
}

const fetchWeather = async (lat: number, lng: number): Promise<WeatherInfo> => {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`
  );
  const data = await res.json();
  return {
    temp: Math.round(data.current.temperature_2m),
    code: data.current.weather_code,
  };
};

function getWeatherDisplay(code: number): {
  emoji: string;
  label: string;
  isPrecipitation: boolean;
} {
  if (code === 0) return { emoji: '☀️', label: 'Güneşli', isPrecipitation: false };
  if (code >= 1 && code <= 3) return { emoji: '⛅', label: 'Parçalı Bulutlu', isPrecipitation: false };
  if (code >= 45 && code <= 48) return { emoji: '🌫️', label: 'Sisli', isPrecipitation: false };
  if (code >= 51 && code <= 67) return { emoji: '🌧️', label: 'Yağmurlu', isPrecipitation: true };
  if (code >= 71 && code <= 77) return { emoji: '❄️', label: 'Karlı', isPrecipitation: true };
  if (code >= 80 && code <= 82) return { emoji: '🌦️', label: 'Sağanak', isPrecipitation: true };
  if (code >= 95 && code <= 99) return { emoji: '⛈️', label: 'Gök Gürültülü', isPrecipitation: true };
  return { emoji: '🌡️', label: 'Bilinmiyor', isPrecipitation: false };
}

function getBusyHoursHint(category: string | null): string | null {
  switch (category) {
    case 'cafe':
      return 'Sabah 9-11 arası en müsait';
    case 'restaurant':
      return 'Öğle 12-13 ve akşam 19-21 kalabalık';
    case 'park':
      return 'Hafta sonu kalabalık';
    case 'library':
      return 'Hafta içi sabah saatleri müsait';
    default:
      return null;
  }
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
  selectedPlaceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  weatherLoading: {
    fontSize: fontSize.caption,
  },
  weatherWarning: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  busyHoursToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  busyHoursTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  busyHoursContent: {
    paddingVertical: spacing.xs,
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
