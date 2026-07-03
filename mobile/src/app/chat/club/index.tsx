import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { getClub, listClubIndex, type ClubIndexEntry } from './_layout';

export default function ClubListScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<ClubIndexEntry[]>([]);

  // Re-read on every focus — a club created via the FAB should show up here
  // immediately when the user navigates back.
  useFocusEffect(
    useCallback(() => {
      listClubIndex().then(setEntries);
    }, []),
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kitap Kulüplerim</Text>
        <TouchableOpacity
          onPress={() => router.push('/chat/club/create')}
          style={styles.addButton}
          testID="club-create-button"
        >
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <EmptyState
            message="Henüz bir kitap kulübün yok"
            description="Arkadaşlarınla kitap değiş tokuşu yapacağınız bir kulüp oluştur"
            actionLabel="Kulüp Oluştur"
            onAction={() => router.push('/chat/club/create')}
            icon="people-outline"
          />
        ) : (
          entries.map((entry) => {
            const stillLoaded = !!getClub(entry.id);
            return (
              <TouchableOpacity
                key={entry.id}
                style={[styles.row, { backgroundColor: colors.surface }, shadows.card]}
                onPress={() => router.push(`/chat/club/${entry.id}`)}
                testID={`club-row-${entry.id}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={[styles.rowDate, { color: colors.textMuted }]}>
                    {stillLoaded
                      ? new Date(entry.createdAt).toLocaleDateString('tr-TR')
                      : 'Uygulama yeniden başlatıldı — detaylar kayboldu'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  addButton: { padding: spacing.xs },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: { flex: 1, fontSize: fontSize.heading, fontWeight: '700' },
  scrollContent: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.body, fontWeight: '600' },
  rowDate: { fontSize: fontSize.caption },
});
