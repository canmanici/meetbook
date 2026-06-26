import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, useColorScheme, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, EmptyState, Skeleton, palette, spacing, fontSize, radius } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { listBlockedUsers, unblockUser, getUser } from '@/lib/api/client';

export default function BlockedUsersScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['blocked-users'],
    queryFn: () => listBlockedUsers(),
    retry: false,
  });
  const items = data?.items ?? [];

  const userQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['user', item.user_id],
      queryFn: () => getUser(item.user_id),
      enabled: !!item.user_id,
    })),
  });

  const usersById = new Map<string, Awaited<ReturnType<typeof getUser>> & { avatar_url?: string }>();
  userQueries.forEach((q, i) => {
    if (q.data) usersById.set(items[i].user_id, q.data as Awaited<ReturnType<typeof getUser>> & { avatar_url?: string });
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => unblockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      toast.show('Engel kaldırıldı', { variant: 'success' });
    },
    onError: () => toast.show('Engel kaldırılamadı', { variant: 'error' }),
  });

  const confirmUnblock = (userId: string) => {
    Alert.alert(
      'Engeli Kaldır',
      'Bu kullanıcının engelini kaldırmak istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Engeli Kaldır',
          style: 'destructive',
          onPress: () => unblockMutation.mutate(userId),
        },
      ],
    );
  };

  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <EmptyState
          message="Engellenen kullanıcılar yüklenemedi"
          description="Bağlantınızı kontrol edip tekrar deneyin."
          actionLabel="Tekrar Dene"
          onAction={() => refetch()}
          icon="cloud-offline"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Engellenen Kullanıcılar</Text>
        <View style={[styles.headerBorder, { backgroundColor: colors.textMuted, opacity: 0.15 }]} />
      </View>

      <ScrollView
        testID="blocked-scroll"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
        {isLoading ? (
          <>
            <Skeleton variant="list-item" />
            <Skeleton variant="list-item" />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            message="Engellenen kullanıcı yok"
            description="Engellediğiniz kullanıcılar burada görünür"
          />
        ) : (
          items.map((item) => {
            const user = usersById.get(item.user_id);
            return (
              <View
                key={item.user_id}
                style={[styles.row, { backgroundColor: colors.surface, borderRadius: radius.input }]}
                testID={`blocked-user-${item.user_id}`}
              >
                <Avatar name={user?.name ?? '?'} imageUrl={user?.avatar_url} size="small" />
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: colors.text }]}>
                    {user?.name ?? 'Kullanıcı'}
                  </Text>
                  <Text style={[styles.rowDate, { color: colors.textMuted }]}>
                    {new Date(item.created_at).toLocaleDateString('tr-TR')} tarihinde engellendi
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => confirmUnblock(item.user_id)}
                  style={[styles.unblockButton, { borderColor: colors.danger }]}
                  testID={`unblock-button-${item.user_id}`}
                >
                  <Text style={[styles.unblockText, { color: colors.danger }]}>Engeli Kaldır</Text>
                </TouchableOpacity>
              </View>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  rowDate: {
    fontSize: fontSize.bodySm,
  },
  unblockButton: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unblockText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
