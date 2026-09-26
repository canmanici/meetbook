import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { Avatar } from './avatar';
import { fontSize, palette, radius, spacing } from './tokens';
import { listExchanges, type ExchangeSummary } from '@/lib/api/client';

interface BookJourneyProps {
  bookId: string;
}

/**
 * "Bu Kitabın Yolculuğu" — a timeline of past handoffs for a book.
 *
 * There is no dedicated history endpoint, so we derive the journey from the
 * exchanges the current user can see (`received` for the owner, `sent` for
 * everyone) and keep only the completed ones tied to this book. The owner
 * therefore sees the full journey; a viewer only sees their own stop, if any.
 */
export function BookJourney({ bookId }: BookJourneyProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['book-journey', bookId],
    queryFn: async () => {
      const [received, sent] = await Promise.all([
        listExchanges({ role: 'received', limit: 50 }),
        listExchanges({ role: 'sent', limit: 50 }),
      ]);
      const seen = new Set<string>();
      const stops: ExchangeSummary[] = [];
      for (const ex of [...received.items, ...sent.items]) {
        if (ex.book?.id !== bookId) continue;
        if (ex.status !== 'completed') continue;
        if (seen.has(ex.id)) continue;
        seen.add(ex.id);
        stops.push(ex);
      }
      stops.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      return stops;
    },
  });

  if (isLoading || isError) return null;

  const stops = data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={styles.header}>
        <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>Bu Kitabın Yolculuğu</Text>
      </View>

      {stops.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="footsteps-outline" size={28} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Bu kitabın yolculuğu yeni başlıyor
          </Text>
        </View>
      ) : (
        <View style={styles.timeline}>
          {stops.map((stop, index) => {
            const isLast = index === stops.length - 1;
            const name = stop.counterpart?.name ?? 'Bilinmeyen';
            const date = formatDate(stop.created_at);
            const review = stop.mode === 'borrow' ? 'Ödünç alındı' : 'Takas yapıldı';
            return (
              <View key={stop.id} style={styles.stop}>
                <View style={styles.stopLeft}>
                  <Avatar name={name} imageUrl={(stop.counterpart as any)?.avatar_url ?? undefined} size="small" />
                  {!isLast && (
                    <View style={[styles.stopLine, { backgroundColor: colors.textMuted + '30' }]} />
                  )}
                </View>
                <View style={[styles.stopRight, isLast && { paddingBottom: 0 }]}>
                  <Text style={[styles.stopName, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.stopDate, { color: colors.textMuted }]}>{date}</Text>
                  <Text
                    style={[styles.stopReview, { color: colors.textMuted }]}
                    numberOfLines={1}>
                    {review}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.sheet,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.bodySm,
    textAlign: 'center',
  },
  timeline: {},
  stop: {
    flexDirection: 'row',
  },
  stopLeft: {
    width: 32,
    alignItems: 'center',
  },
  stopLine: {
    width: 2,
    flex: 1,
    minHeight: 20,
    marginTop: spacing.xs,
  },
  stopRight: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingLeft: spacing.sm,
    gap: 2,
  },
  stopName: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  stopDate: {
    fontSize: fontSize.caption,
  },
  stopReview: {
    fontSize: fontSize.caption,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
