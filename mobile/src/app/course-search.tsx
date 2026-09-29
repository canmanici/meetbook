import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCover, EmptyState, Skeleton, palette, radius, spacing, fontSize } from '@/components/ui';
import {
  coverUrl,
  listCourses,
  searchCourseBooks,
  type CourseBook,
  type CourseSummary,
} from '@/lib/api/courses';
import { courseCodePrefix } from '@/lib/course-code';
import { BOOK_CONDITION_LABELS, type BookCondition } from '@/constants/books';
import { formatDistance } from '@/lib/format';

/** Last known position — only if permission was already given; never prompts here. */
async function knownPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getLastKnownPositionAsync();
    return loc ? { lat: loc.coords.latitude, lng: loc.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * "Who on campus has the book for MAT101?" — search by course code instead of
 * title. Next year's students get this year's copies.
 */
export default function CourseSearchScreen() {
  const isDark = useColorScheme() === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();

  const [query, setQuery] = useState(params.code ?? '');
  const [selected, setSelected] = useState<string | null>(params.code ? courseCodePrefix(params.code) : null);
  const [debounced, setDebounced] = useState(query);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    knownPosition().then(setOrigin);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const courses = useQuery({
    queryKey: ['courses', courseCodePrefix(debounced)],
    queryFn: () => listCourses(courseCodePrefix(debounced)),
    enabled: !selected,
  });

  const books = useQuery({
    queryKey: ['course-books', selected, origin?.lat, origin?.lng],
    queryFn: () => searchCourseBooks(selected!, origin),
    enabled: !!selected,
  });

  const pick = (code: string) => {
    setSelected(code);
    setQuery(code);
  };

  const clear = () => {
    setSelected(null);
    setQuery('');
  };

  const renderCourse = ({ item }: { item: CourseSummary }) => (
    <TouchableOpacity
      style={[styles.courseRow, { backgroundColor: colors.surface }]}
      onPress={() => pick(item.course_code)}
      testID={`course-${item.course_code}`}
      accessibilityRole="button"
    >
      <View style={[styles.codeBadge, { backgroundColor: colors.primarySoft }]}>
        <Text style={[styles.codeText, { color: colors.primary }]}>{item.course_code}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{item.book_count} kitap</Text>
        {item.instructors?.length ? (
          <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={1}>
            {item.instructors.join(', ')}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const renderBook = ({ item }: { item: CourseBook }) => (
    <TouchableOpacity
      style={[styles.bookRow, { backgroundColor: colors.surface }]}
      onPress={() => router.push(`/book/${item.id}`)}
      testID={`course-book-${item.id}`}
      accessibilityRole="button"
    >
      <BookCover url={coverUrl(item)} size={48} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
        {item.author ? (
          <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={1}>{item.author}</Text>
        ) : null}
        <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={1}>
          {[
            item.instructor,
            BOOK_CONDITION_LABELS[item.condition as BookCondition],
            origin ? formatDistance(item.distance_km) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="school-outline" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setSelected(null);
            }}
            placeholder="Ders kodu: MAT101, FIZ101…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus={!params.code}
            onSubmitEditing={() => {
              const code = courseCodePrefix(query);
              if (code) pick(code);
            }}
            style={[styles.searchInput, { color: colors.text }]}
            testID="course-search-input"
          />
          {!!query && (
            <TouchableOpacity onPress={clear} testID="course-search-clear" accessibilityLabel="Temizle">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {selected ? (
        books.isLoading ? (
          <View style={styles.list}>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </View>
        ) : (
          <FlatList
            data={books.data?.items ?? []}
            keyExtractor={(b) => b.id}
            renderItem={renderBook}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                {selected} İÇİN {origin ? 'YAKINDAKİ ' : ''}KİTAPLAR
              </Text>
            }
            ListEmptyComponent={
              <EmptyState
                message={books.isError ? 'Kitaplar yüklenemedi' : `${selected} için henüz kitap yok`}
                description={
                  books.isError
                    ? 'Bağlantını kontrol edip tekrar dene.'
                    : 'Bu dersi geçen dönem alanlar kitaplarını listelediğinde burada görünecek.'
                }
              />
            }
          />
        )
      ) : (
        <FlatList
          data={courses.data?.items ?? []}
          keyExtractor={(c) => c.course_code}
          renderItem={renderCourse}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            courses.isLoading ? (
              <Skeleton variant="card" />
            ) : (
              <EmptyState
                message={query ? 'Bu kodla ders bulunamadı' : 'Henüz ders kodlu kitap yok'}
                description="Kitap eklerken ders kodunu yazarsan, o dersi alan öğrenciler seni bulur."
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backButton: { padding: spacing.xs },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: fontSize.body, fontWeight: '600' },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  sectionLabel: { fontSize: fontSize.caption, fontWeight: '800', letterSpacing: 0.8, marginBottom: spacing.xs },
  courseRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.card },
  codeBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.field, minWidth: 84, alignItems: 'center' },
  codeText: { fontSize: fontSize.bodySm, fontWeight: '900', letterSpacing: 0.5 },
  bookRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.card, alignItems: 'center' },
  rowTitle: { fontSize: fontSize.body, fontWeight: '700' },
  rowSub: { fontSize: fontSize.caption, marginTop: 2 },
});
