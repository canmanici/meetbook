import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, EmptyState, palette, spacing, fontSize, radius } from '@/components/ui';
import { searchUsers, type UserSearchResult } from '@/lib/api/client';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

export default function UserSearchScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      searchUsers(trimmed)
        .then((res) => {
          if (requestId !== requestIdRef.current) return; // stale response — a newer query already fired
          setResults(res.items);
          setSearched(true);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setSearched(true);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kullanıcı Ara</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="İsim veya @kullanıcıadı ara..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            testID="user-search-input"
          />
          {loading && <ActivityIndicator size="small" color={colors.textMuted} />}
          {!loading && query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
          <Text style={[styles.hint, { color: colors.textMuted }]}>En az 2 karakter yazın</Text>
        ) : searched && !loading && results.length === 0 ? (
          <EmptyState
            message="Kullanıcı bulunamadı"
            description="Farklı bir isimle tekrar dene"
            icon="person-outline"
          />
        ) : (
          results.map((u) => (
            <TouchableOpacity
              key={u.id}
              style={[styles.row, { backgroundColor: colors.surface }]}
              onPress={() => router.push(`/user/${u.id}`)}
              testID={`user-search-result-${u.id}`}
            >
              <Avatar name={u.name} imageUrl={u.avatar_url ?? undefined} size="small" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                  {u.name}
                </Text>
                {!!u.username && (
                  <Text style={[styles.rowUsername, { color: colors.textMuted }]} numberOfLines={1}>
                    @{u.username}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: fontSize.body },
  scrollContent: { padding: spacing.lg, gap: spacing.sm },
  hint: { textAlign: 'center', fontSize: fontSize.bodySm, marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
  },
  rowName: { fontSize: fontSize.body, fontWeight: '600' },
  rowUsername: { fontSize: fontSize.caption, marginTop: 1 },
});
