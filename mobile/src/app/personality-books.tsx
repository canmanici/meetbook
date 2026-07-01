import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

import {
  Badge,
  BookCover,
  Button,
  InlineError,
  Input,
  fontSize,
  palette,
  radius,
  shadows,
  spacing,
} from '@/components/ui';
import { ApiError, searchNearbyBooks } from '@/lib/api/client';

const PERSONALITY_BOOKS_KEY = 'personality_books';
const MAX_BOOKS = 3;
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;

type PersonalityBook = {
  isbn?: string;
  title: string;
  author?: string;
};

type SearchResult = {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  cover_url?: string;
};

function dedupeKey(book: { isbn?: string; title: string }): string {
  if (book.isbn) return `isbn:${book.isbn}`;
  return `title:${book.title.trim().toLowerCase()}`;
}

export default function PersonalityBooksScreen() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PersonalityBook[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const data = await searchNearbyBooks({ q, limit: 30 });
        if (cancelled) return;
        const seen = new Set<string>();
        const deduped: SearchResult[] = [];
        for (const item of data.items) {
          const cover = item.photos[0]?.thumbnail_url ?? item.photos[0]?.url;
          const r: SearchResult = {
            id: item.id,
            title: item.title,
            author: item.author,
            isbn: item.isbn,
            cover_url: cover,
          };
          const key = dedupeKey(r);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(r);
        }
        setResults(deduped);
        setSearchError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setSearchError('Oturum süresi doldu, lütfen tekrar giriş yap.');
        } else {
          setSearchError('Arama yapılamadı. Lütfen tekrar deneyin.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const isSelected = (r: SearchResult) => selected.some((s) => dedupeKey(s) === dedupeKey(r));
  const canAddMore = selected.length < MAX_BOOKS;

  const addBook = (r: SearchResult) => {
    setSelected((prev) => {
      if (prev.length >= MAX_BOOKS) return prev;
      const book: PersonalityBook = { isbn: r.isbn, title: r.title, author: r.author };
      if (prev.some((s) => dedupeKey(s) === dedupeKey(book))) return prev;
      return [...prev, book];
    });
  };

  const removeBook = (index: number) =>
    setSelected((prev) => prev.filter((_, i) => i !== index));

  const persistAndContinue = async (books: PersonalityBook[]) => {
    setSaving(true);
    try {
      await AsyncStorage.setItem(PERSONALITY_BOOKS_KEY, JSON.stringify(books));
    } catch {
      // Best-effort local storage; navigation proceeds regardless.
    } finally {
      setSaving(false);
      router.replace('/tabs/home');
    }
  };

  const onComplete = () => persistAndContinue(selected);
  const onSkip = () => persistAndContinue([]);

  const trimmedQuery = query.trim();
  const showHelper =
    trimmedQuery.length > 0 && trimmedQuery.length < MIN_QUERY_LENGTH;

  return (
    <KeyboardAvoidingView
      testID="personality-keyboard-view"
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View
            style={[
              styles.logo,
              { backgroundColor: colors.accent },
              shadows.float,
              { shadowColor: colors.accent },
            ]}>
            <Ionicons name="book" size={32} color="#fff" />
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>
            Seni tanımlayan 3 kitabı seç
          </Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            Kitap İkizini bulmana yardımcı olacak
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
            shadows.card,
          ]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Seçilen kitaplar
            </Text>
            <Badge
              testID="personality-count"
              text={`${selected.length} / ${MAX_BOOKS}`}
              variant={selected.length === MAX_BOOKS ? 'success' : 'info'}
            />
          </View>

          {selected.length === 0 ? (
            <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
              Henüz kitap seçilmedi. İstersen atlayabilirsin.
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {selected.map((book, index) => (
                <View
                  key={`${index}-${dedupeKey(book)}`}
                  style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.chipText, { color: colors.primary }]}>
                    {book.title}
                  </Text>
                  <Pressable
                    testID={`personality-remove-${index}`}
                    onPress={() => removeBook(index)}
                    hitSlop={8}
                    style={styles.chipRemove}>
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Input
            testID="personality-search-input"
            label="Kitap ara"
            placeholder="Başlık, yazar veya ISBN"
            value={query}
            onChangeText={setQuery}
            helper={showHelper ? 'Aramak için en az 2 karakter yaz' : undefined}
          />

          {searching ? (
            <Text style={[styles.stateText, { color: colors.textMuted }]}>
              Aranıyor…
            </Text>
          ) : searchError ? (
            <InlineError message={searchError} />
          ) : trimmedQuery.length >= MIN_QUERY_LENGTH && results.length === 0 ? (
            <Text style={[styles.stateText, { color: colors.textMuted }]}>
              Sonuç bulunamadı.
            </Text>
          ) : (
            <View style={styles.results}>
              {results.map((r) => {
                const selectedAlready = isSelected(r);
                return (
                  <View
                    key={`${r.id}-${dedupeKey(r)}`}
                    style={[styles.resultRow, { borderColor: colors.border }]}>
                    <BookCover url={r.cover_url} size={40} />
                    <View style={styles.resultInfo}>
                      <Text
                        numberOfLines={2}
                        style={[styles.resultTitle, { color: colors.text }]}>
                        {r.title}
                      </Text>
                      {r.author ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.resultAuthor, { color: colors.textMuted }]}>
                          {r.author}
                        </Text>
                      ) : null}
                    </View>
                    {selectedAlready ? (
                      <Badge text="Eklendi" variant="success" />
                    ) : canAddMore ? (
                      <Pressable
                        testID={`personality-add-${r.id}`}
                        onPress={() => addBook(r)}
                        style={[styles.addAction, { backgroundColor: colors.primarySoft }]}>
                        <Text style={[styles.addActionText, { color: colors.primary }]}>
                          Ekle
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={[styles.limitText, { color: colors.textMuted }]}>
                        Dolu
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <Button
            testID="personality-done"
            onPress={onComplete}
            disabled={selected.length === 0 || saving}
            loading={saving}>
            Tamamla
          </Button>
          <Button testID="personality-skip" onPress={onSkip} variant="ghost">
            Atla
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.xl,
    justifyContent: 'center',
    flexGrow: 1,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  brand: {
    fontSize: fontSize.heading,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  tagline: {
    fontSize: fontSize.bodySm,
    fontWeight: '500',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '800',
  },
  emptyHint: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    maxWidth: 160,
  },
  chipRemove: {
    paddingLeft: spacing.xs,
  },
  stateText: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    paddingVertical: spacing.sm,
  },
  results: {
    gap: spacing.xs,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultInfo: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  resultAuthor: {
    fontSize: fontSize.caption,
  },
  addAction: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
  },
  addActionText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  limitText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
