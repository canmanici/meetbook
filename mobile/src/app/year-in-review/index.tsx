import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, {
  FadeInDown,
  SlideInRight,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getExchange, listExchanges, type ExchangeSummary } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stop = {
  id: string;
  lat: number;
  lng: number;
  place_name: string;
  place_key: string;
  at: number;
};
type Person = { id: string; name: string; avatarUrl?: string };
type YirStats = {
  total: number;
  km: number;
  people: Person[];
  cities: number;
  stops: Stop[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatTr(n: number): string {
  return n.toLocaleString('tr-TR');
}

/**
 * Count-up number driven by reanimated. Animates from 0 → target whenever
 * `active` flips true (so it replays each time the slide is swiped into view).
 */
function useCountUp(target: number, active: boolean, duration = 1100): number {
  const [display, setDisplay] = useState(0);
  const sv = useSharedValue(0);

  useEffect(() => {
    if (active && target > 0) {
      sv.value = 0;
      sv.value = withTiming(target, { duration });
    } else {
      sv.value = 0;
      setDisplay(target);
    }
  }, [target, active, duration, sv]);

  useAnimatedReaction(
    () => Math.round(sv.value),
    (cur, prev) => {
      if (cur !== prev) runOnJS(setDisplay)(cur);
    },
  );

  return display;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadYearInReview(): Promise<YirStats> {
  const [received, sent] = await Promise.all([
    listExchanges({ role: 'received', status: 'completed', limit: 50 }),
    listExchanges({ role: 'sent', status: 'completed', limit: 50 }),
  ]);

  const seen = new Set<string>();
  const items: ExchangeSummary[] = [];
  for (const ex of [...received.items, ...sent.items]) {
    if (seen.has(ex.id)) continue;
    seen.add(ex.id);
    items.push(ex);
  }
  items.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));

  // Pull meetup geo for each exchange (resilient to individual failures).
  const details = await Promise.allSettled(items.map((ex) => getExchange(ex.id)));
  const events: Stop[] = [];
  details.forEach((d, i) => {
    if (d.status !== 'fulfilled') return;
    const m = d.value.meetup;
    if (!m || typeof m.lat !== 'number' || typeof m.lng !== 'number') return;
    const place_name = m.place_name?.trim() || 'Buluşma noktası';
    const place_key =
      (m.place_id && String(m.place_id)) || place_name || `${m.lat.toFixed(3)},${m.lng.toFixed(3)}`;
    events.push({
      id: items[i].id,
      lat: m.lat,
      lng: m.lng,
      place_name,
      place_key,
      at: +new Date(items[i].created_at),
    });
  });
  events.sort((a, b) => a.at - b.at);

  // Unique counterpart people.
  const peopleMap = new Map<string, Person>();
  for (const ex of items) {
    const c = ex.counterpart;
    if (c?.id && !peopleMap.has(c.id)) {
      peopleMap.set(c.id, { id: c.id, name: c.name?.trim() || 'Kitap kurdu', avatarUrl: (c as any).avatar_url ?? undefined });
    }
  }

  // Distance walked = sum of haversine between consecutive meetups.
  let km = 0;
  for (let i = 1; i < events.length; i += 1) {
    km += haversineKm(events[i - 1], events[i]);
  }

  // Unique stops (by place) for the map + city count.
  const stopsSeen = new Set<string>();
  const stops: Stop[] = [];
  for (const ev of events) {
    if (stopsSeen.has(ev.place_key)) continue;
    stopsSeen.add(ev.place_key);
    stops.push(ev);
  }

  return {
    total: items.length,
    km: Math.round(km),
    people: Array.from(peopleMap.values()),
    cities: stops.length,
    stops,
  };
}

// ---------------------------------------------------------------------------
// Mini map (SVG) — no react-native-maps dependency required
// ---------------------------------------------------------------------------

const MAP_W = 320;
const MAP_H = 220;
const MAP_PAD = 0.14;

function MiniMap({ stops, stroke, pin, fill }: {
  stops: Stop[];
  stroke: string;
  pin: string;
  fill: string;
}) {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1e-4;
  const spanLng = maxLng - minLng || 1e-4;

  const usableW = MAP_W * (1 - 2 * MAP_PAD);
  const usableH = MAP_H * (1 - 2 * MAP_PAD);
  const project = (s: Stop) => ({
    x: MAP_W * MAP_PAD + ((s.lng - minLng) / spanLng) * usableW,
    y: MAP_H * (1 - MAP_PAD) - ((s.lat - minLat) / spanLat) * usableH,
  });
  const pts = stops.map(project);
  const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View style={mapStyles.wrap}>
      <Svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" height={MAP_H} style={mapStyles.svg}>
        <Rect x={0} y={0} width={MAP_W} height={MAP_H} rx={16} ry={16} fill={fill} />
        {/* subtle grid */}
        {[0.25, 0.5, 0.75].map((t) => (
          <G key={`v${t}`}>
            <Line
              x1={MAP_W * t}
              y1={MAP_H * 0.06}
              x2={MAP_W * t}
              y2={MAP_H * 0.94}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.18}
            />
            <Line
              x1={MAP_W * 0.06}
              y1={MAP_H * t}
              x2={MAP_W * 0.94}
              y2={MAP_H * t}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.18}
            />
          </G>
        ))}
        {pts.length > 1 && (
          <Polyline
            points={polyPoints}
            fill="none"
            stroke={stroke}
            strokeWidth={2.5}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}
        {pts.map((p, i) => (
          <G key={stops[i].id}>
            <Circle cx={p.x} cy={p.y} r={9} fill={pin} stroke="#FFFFFF" strokeWidth={2.5} />
            <SvgText
              x={p.x}
              y={p.y + 3}
              fontSize={9}
              fontWeight="700"
              fill="#FFFFFF"
              textAnchor="middle"
            >
              {i + 1}
            </SvgText>
          </G>
        ))}
      </Svg>
    </View>
  );
}

const mapStyles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  svg: {
    backgroundColor: 'transparent',
  },
});

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function BigStat({
  value,
  active,
  suffix,
}: {
  value: number;
  active: boolean;
  suffix?: string;
}) {
  const display = useCountUp(value, active);
  return (
    <Text style={slideStyles.bigNumber} testID="yir-bignum">
      {formatTr(display)}
      {suffix ? <Text style={slideStyles.bigNumberSuffix}> {suffix}</Text> : null}
    </Text>
  );
}

function BooksSlide({ stats, active }: { stats: YirStats; active: boolean }) {
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={SlideInRight.delay(60)} style={slideStyles.inner}>
      <Ionicons name="book" size={56} color="#FFFFFF" style={slideStyles.icon} />
      <Text style={slideStyles.eyebrow}>Bu yıl seninle olanlar</Text>
      <BigStat value={stats.total} active={active} />
      <Text style={slideStyles.headline}>kitap takas ettin</Text>
      <Text style={slideStyles.subline}>
        Her biri yeni bir hikâye, yeni bir eve yolculuktu.
      </Text>
    </Animated.View>
  );
}

function KmSlide({ stats, active }: { stats: YirStats; active: boolean }) {
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={SlideInRight.delay(60)} style={slideStyles.inner}>
      <Text style={slideStyles.emoji}>🗺️</Text>
      <BigStat value={stats.km} active={active} suffix="km" />
      <Text style={slideStyles.headline}>yürüdün</Text>
      <Text style={slideStyles.subline}>
        Kitaplarını sahiplerine yetiştirmek için attığın adımlar.
      </Text>
    </Animated.View>
  );
}

function PeopleSlide({ stats, active }: { stats: YirStats; active: boolean }) {
  const shown = stats.people.slice(0, 12);
  const extra = stats.people.length - shown.length;
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={SlideInRight.delay(60)} style={slideStyles.inner}>
      <Text style={slideStyles.emoji}>🤝</Text>
      <BigStat value={stats.people.length} active={active} />
      <Text style={slideStyles.headline}>yeni kişiyle tanıştın</Text>
      <View style={slideStyles.avatarGrid}>
        {shown.map((p) => (
          <View key={p.id} style={slideStyles.avatarCell}>
            <Avatar name={p.name} imageUrl={p.avatarUrl} size="small" />
            <Text style={slideStyles.avatarName} numberOfLines={1}>
              {p.name}
            </Text>
          </View>
        ))}
        {extra > 0 && (
          <View style={slideStyles.avatarCell}>
            <View style={slideStyles.moreCell}>
              <Text style={slideStyles.moreText}>+{extra}</Text>
            </View>
            <Text style={slideStyles.avatarName} numberOfLines={1}>
              daha
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function CitiesSlide({ stats, active }: { stats: YirStats; active: boolean }) {
  const hasStops = stats.stops.length > 0;
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={SlideInRight.delay(60)} style={slideStyles.inner}>
      <Text style={slideStyles.emoji}>📍</Text>
      <BigStat value={stats.cities} active={active} />
      <Text style={slideStyles.headline}>rotaya ulaştı</Text>
      {hasStops ? (
        <>
          <View style={slideStyles.mapCard}>
            <MiniMap stops={stats.stops} stroke="#FFFFFF" pin="#FFFFFF" fill="rgba(255,255,255,0.14)" />
          </View>
          <View style={slideStyles.chipRow}>
            {stats.stops.slice(0, 4).map((s, i) => (
              <View key={s.id} style={slideStyles.chip}>
                <Text style={slideStyles.chipIndex}>{i + 1}</Text>
                <Text style={slideStyles.chipText} numberOfLines={1}>
                  {s.place_name}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={slideStyles.subline}>Buluşma konumların haritada görünecek.</Text>
      )}
    </Animated.View>
  );
}

function ShareSlide({
  stats,
  active,
  onReplay,
}: {
  stats: YirStats;
  active: boolean;
  onReplay: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const year = new Date().getFullYear();

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const message =
        `📖 ${year} Kitap Yılım\n\n` +
        `📚 ${formatTr(stats.total)} kitap takas ettim\n` +
        `🗺️ ${formatTr(stats.km)} km yürüdüm\n` +
        `🤝 ${formatTr(stats.people.length)} yeni kişiyle tanıştım\n` +
        `📍 Kitaplarım ${formatTr(stats.cities)} rotaya ulaştı\n\n` +
        `MeetBook ile kitaplarını paylaş.`;
      await Share.share({ message });
    } catch {
      /* user dismissed — ignore */
    } finally {
      setSharing(false);
    }
  };

  return (
    <Animated.View key={active ? 'on' : 'off'} entering={FadeInDown.delay(60)} style={slideStyles.innerShare}>
      <View style={slideStyles.shareCard}>
        <LinearGradient
          colors={['#11806B', '#F2766B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={slideStyles.shareGradient}
        >
          <Text style={slideStyles.shareEyebrow}>MEETBOOK</Text>
          <Text style={slideStyles.shareTitle}>{year} Kitap Yılım</Text>
          <View style={slideStyles.shareDivider} />
          <View style={slideStyles.shareStatRow}>
            <Text style={slideStyles.shareStatIcon}>📚</Text>
            <Text style={slideStyles.shareStatValue}>{formatTr(stats.total)}</Text>
            <Text style={slideStyles.shareStatLabel}>kitap takas</Text>
          </View>
          <View style={slideStyles.shareStatRow}>
            <Text style={slideStyles.shareStatIcon}>🗺️</Text>
            <Text style={slideStyles.shareStatValue}>{formatTr(stats.km)}</Text>
            <Text style={slideStyles.shareStatLabel}>km yürüdün</Text>
          </View>
          <View style={slideStyles.shareStatRow}>
            <Text style={slideStyles.shareStatIcon}>🤝</Text>
            <Text style={slideStyles.shareStatValue}>{formatTr(stats.people.length)}</Text>
            <Text style={slideStyles.shareStatLabel}>yeni kişi</Text>
          </View>
          <View style={slideStyles.shareStatRow}>
            <Text style={slideStyles.shareStatIcon}>📍</Text>
            <Text style={slideStyles.shareStatValue}>{formatTr(stats.cities)}</Text>
            <Text style={slideStyles.shareStatLabel}>rota</Text>
          </View>
        </LinearGradient>
      </View>

      <View style={slideStyles.shareActions}>
        <TouchableOpacity
          style={slideStyles.primaryBtn}
          onPress={share}
          disabled={sharing}
          activeOpacity={0.85}
          testID="yir-share-button"
        >
          {sharing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="share-outline" size={18} color="#FFFFFF" />
              <Text style={slideStyles.primaryBtnText}>Paylaş</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={slideStyles.ghostBtn}
          onPress={onReplay}
          activeOpacity={0.7}
          testID="yir-replay-button"
        >
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={slideStyles.ghostBtnText}>Tekrar izle</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function FallbackSlide() {
  return (
    <View style={slideStyles.inner}>
      <Text style={slideStyles.emoji}>📚</Text>
      <Text style={slideStyles.headline}>Henüz takas yapmadın</Text>
      <Text style={slideStyles.subline}>
        İlk kitabını ekle ve başla!
      </Text>
      <TouchableOpacity
        style={slideStyles.primaryBtn}
        onPress={() => router.push('/book/new')}
        activeOpacity={0.85}
        testID="yir-fallback-cta"
      >
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={slideStyles.primaryBtnText}>İlk kitabını ekle</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const SLIDE_GRADIENTS: [string, string][] = [
  ['#15917A', '#0C5E50'],
  ['#3D7AB0', '#1E3A5F'],
  ['#BC4F7A', '#6E3B6E'],
  ['#B0822A', '#6E4A14'],
];

export default function YearInReviewScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settledIndex, setSettledIndex] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery<YirStats>({
    queryKey: ['year-in-review'],
    queryFn: loadYearInReview,
  });

  const isFallback = !!data && data.total === 0;
  const slideCount = isFallback ? 1 : 5;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setSettledIndex(idx);
  };

  const replay = () => {
    scrollRef.current?.scrollTo({ x: 0, animated: true });
    setSettledIndex(0);
  };  const headerGradient: [string, string] = isFallback
    ? ['#15917A', '#0C5E50']
    : SLIDE_GRADIENTS[Math.min(activeIndex, SLIDE_GRADIENTS.length - 1)];

  if (isLoading) {
    return (
      <LinearGradient
        colors={['#15917A', '#0C5E50']}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + spacing.sm }]}
          onPress={() => router.back()}
          hitSlop={10}
          activeOpacity={0.7}
          testID="yir-back-button"
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Yılın özeti hazırlanıyor…</Text>
        </View>
      </LinearGradient>
    );
  }

  if (isError || !data) {
    return (
      <LinearGradient
        colors={['#15917A', '#0C5E50']}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + spacing.sm }]}
          onPress={() => router.back()}
          hitSlop={10}
          activeOpacity={0.7}
          testID="yir-back-button"
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.loading}>
          <Ionicons name="cloud-offline-outline" size={40} color="#FFFFFF" />
          <Text style={styles.loadingText}>Bir şeyler ters gitti.</Text>
          <TouchableOpacity
            style={slideStyles.primaryBtn}
            onPress={() => refetch()}
            activeOpacity={0.85}
          >
            <Text style={slideStyles.primaryBtnText}>Tekrar dene</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={headerGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + spacing.sm }]}
        onPress={() => router.back()}
        hitSlop={10}
        activeOpacity={0.7}
        testID="yir-back-button"
      >
        <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={onSettle}
        style={styles.pager}
      >
        {isFallback ? (
          <View style={[styles.slide, { width }]}>
            <LinearGradient
              colors={SLIDE_GRADIENTS[0]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.slideBg}
            >
              <FallbackSlide />
            </LinearGradient>
          </View>
        ) : (
          [0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <LinearGradient
                colors={i < 4 ? SLIDE_GRADIENTS[i] : ['#0C5E50', '#15140F']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.slideBg}
              >
                {i === 0 && <BooksSlide stats={data} active={settledIndex === 0} />}
                {i === 1 && <KmSlide stats={data} active={settledIndex === 1} />}
                {i === 2 && <PeopleSlide stats={data} active={settledIndex === 2} />}
                {i === 3 && <CitiesSlide stats={data} active={settledIndex === 3} />}
                {i === 4 && (
                  <ShareSlide stats={data} active={settledIndex === 4} onReplay={replay} />
                )}
              </LinearGradient>
            </View>
          ))
        )}
      </ScrollView>

      {/* Page dots */}
      {!isFallback && (
        <View style={[styles.dots, { marginBottom: insets.bottom + spacing.lg }]}>
          {Array.from({ length: slideCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex && styles.dotActive,
                { backgroundColor: i === activeIndex ? '#FFFFFF' : 'rgba(255,255,255,0.45)' },
              ]}
            />
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Slide-level styles (white text on colored gradients)
// ---------------------------------------------------------------------------

const slideStyles = StyleSheet.create({
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl + spacing.xl,
  },
  innerShare: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl + spacing.xl,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  icon: {
    marginBottom: spacing.lg,
    opacity: 0.95,
  },
  emoji: {
    fontSize: 52,
    marginBottom: spacing.md,
  },
  bigNumber: {
    color: '#FFFFFF',
    fontSize: 84,
    fontWeight: '900',
    letterSpacing: -2,
    textAlign: 'center',
  },
  bigNumberSuffix: {
    fontSize: 40,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.9)',
  },
  headline: {
    color: '#FFFFFF',
    fontSize: fontSize.heading + 4,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.xs,
    letterSpacing: -0.3,
  },
  subline: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.body,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    maxWidth: 300,
  },
  avatarCell: {
    alignItems: 'center',
    width: 64,
    gap: spacing.xs,
  },
  avatarName: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
  moreCell: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  mapCard: {
    width: '100%',
    marginTop: spacing.lg,
    borderRadius: radius.card,
    padding: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    maxWidth: 140,
  },
  chipIndex: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  shareCard: {
    width: '100%',
    borderRadius: radius.sheet,
    overflow: 'hidden',
    ...shadows.float,
    shadowColor: '#000000',
  },
  shareGradient: {
    padding: spacing.xl,
    borderRadius: radius.sheet,
  },
  shareEyebrow: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 2,
  },
  shareTitle: {
    color: '#FFFFFF',
    fontSize: fontSize.display + 4,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: spacing.xs,
  },
  shareDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginVertical: spacing.md,
  },
  shareStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 1,
  },
  shareStatIcon: {
    fontSize: fontSize.body,
    width: 26,
  },
  shareStatValue: {
    color: '#FFFFFF',
    fontSize: fontSize.heading,
    fontWeight: '900',
    minWidth: 52,
  },
  shareStatLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  shareActions: {
    width: '100%',
    marginTop: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.button,
    minWidth: 200,
  },
  primaryBtnText: {
    color: '#0C5E50',
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  ghostBtnText: {
    color: '#FFFFFF',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});

// ---------------------------------------------------------------------------
// Screen-level styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
  },
  slideBg: {
    flex: 1,
  },
  backBtn: {
    position: 'absolute',
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: fontSize.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  dotActive: {
    width: 26,
    height: 8,
  },
});
