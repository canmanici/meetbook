import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Skeleton, palette, pastels, radius, shadows, spacing, fontSize } from '@/components/ui';
import { getMe } from '@/lib/api/client';
import { CREDIT_KIND_LABELS, getWallet, type CreditTransaction } from '@/lib/api/credits';

const HOW_IT_WORKS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'arrow-up-circle', text: 'Bir kitap verdiğinde 1 kredi kazanırsın.' },
  { icon: 'arrow-down-circle', text: 'Bir kitap aldığında 1 kredi harcarsın.' },
  { icon: 'school', text: 'Öğrenciler 1 hoş geldin kredisi alır ve 2 krediye kadar borçlanabilir: dönem bitince aldığın kitabı yeniden listele, borcun kapansın.' },
  { icon: 'lock-closed', text: 'Ödünç alırken depozito ayrılır; kitap dönünce geri gelir. Dönmezse depozito kitabın sahibine geçer.' },
  { icon: 'cash-outline', text: 'Krediler paraya çevrilemez, satılamaz.' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CreditsScreen() {
  const isDark = useColorScheme() === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const tints = pastels[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet, refetchOnMount: 'always' });
  const me = useQuery({ queryKey: ['me'], queryFn: () => getMe() });
  const w = wallet.data;
  const eduDomain = me.data?.edu_email?.split('@')[1];

  const header = (
    <View style={[styles.header, { backgroundColor: colors.surface }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Kitap Kredim</Text>
    </View>
  );

  if (wallet.isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        {header}
        <View style={styles.centered}>
          <Text style={[styles.muted, { color: colors.textMuted }]}>Kredilerin yüklenemedi.</Text>
          <Button onPress={() => wallet.refetch()} testID="credits-retry">Tekrar dene</Button>
        </View>
      </View>
    );
  }

  const inDebt = !!w && w.balance < 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xxxl + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={wallet.isRefetching} onRefresh={() => wallet.refetch()} />
        }
      >
        {!w ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : (
          <>
            {/* Balance */}
            <View style={[styles.hero, { backgroundColor: colors.primary }, shadows.card]} testID="credits-hero">
              <Text style={styles.heroLabel}>Bakiyen</Text>
              <Text style={styles.heroValue} testID="credits-balance">
                {w.balance}
              </Text>
              <Text style={styles.heroSub}>
                {inDebt ? `${-w.balance} kredi borcun var` : 'kredi'}
              </Text>
              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue} testID="credits-available">{w.available}</Text>
                  <Text style={styles.heroStatLabel}>Kullanılabilir</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{w.reserved}</Text>
                  <Text style={styles.heroStatLabel}>Taleplerde ayrılan</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{w.floor}</Text>
                  <Text style={styles.heroStatLabel}>En düşük bakiye</Text>
                </View>
              </View>
            </View>

            {/* Student verification */}
            {w.edu_verified ? (
              <View style={[styles.row, { backgroundColor: tints.mint.bg }]} testID="credits-edu-verified">
                <Ionicons name="school" size={22} color={tints.mint.ink} />
                <Text style={[styles.rowText, { color: tints.mint.ink }]}>
                  Öğrenci doğrulandı{eduDomain ? ` · ${eduDomain}` : ''}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}
                onPress={() => router.push('/settings/student-verification' as any)}
                testID="credits-verify-cta"
                accessibilityRole="button"
              >
                <View style={[styles.iconChip, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="school" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>Öğrenci misin?</Text>
                  <Text style={[styles.cardBody, { color: colors.textMuted }]}>
                    Öğretmeninden aldığın kodu gir: 1 hoş geldin kredisi ve 2 kredi borç hakkı kazan.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {/* Borrowing */}
            {w.borrow_banned ? (
              <View style={[styles.row, { backgroundColor: tints.coral.bg }]} testID="credits-borrow-banned">
                <Ionicons name="ban" size={22} color={tints.coral.ink} />
                <Text style={[styles.rowText, { color: tints.coral.ink }]}>
                  İade edilmeyen bir kitap yüzünden ödünç alma hakkın kapalı.
                </Text>
              </View>
            ) : (
              <View style={[styles.row, { backgroundColor: colors.surface }]} testID="credits-borrow-status">
                <Ionicons
                  name={w.can_borrow ? 'lock-open' : 'lock-closed'}
                  size={22}
                  color={w.can_borrow ? colors.success : colors.textMuted}
                />
                <Text style={[styles.rowText, { color: colors.text }]}>
                  {w.can_borrow
                    ? `Ödünç alabilirsin (depozito: ${w.loan_deposit} kredi)`
                    : `Ödünç almak için ${w.loan_deposit} kullanılabilir kredi gerekir`}
                </Text>
              </View>
            )}

            {/* How it works */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>NASIL ÇALIŞIR</Text>
            <View style={[styles.list, { backgroundColor: colors.surface }]}>
              {HOW_IT_WORKS.map((item) => (
                <View key={item.text} style={styles.howRow}>
                  <Ionicons name={item.icon} size={18} color={colors.primary} />
                  <Text style={[styles.howText, { color: colors.text }]}>{item.text}</Text>
                </View>
              ))}
            </View>

            {/* History */}
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>HAREKETLER</Text>
            <View style={[styles.list, { backgroundColor: colors.surface }]} testID="credits-history">
              {w.transactions.length === 0 ? (
                <Text style={[styles.muted, { color: colors.textMuted, padding: spacing.md }]}>
                  Henüz kredi hareketin yok. İlk kitabını verince burada görünecek.
                </Text>
              ) : (
                w.transactions.map((t: CreditTransaction) => (
                  <View key={t.id} style={styles.txRow} testID={`credits-tx-${t.kind}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txLabel, { color: colors.text }]}>{CREDIT_KIND_LABELS[t.kind]}</Text>
                      <Text style={[styles.txDate, { color: colors.textMuted }]}>{formatDate(t.created_at)}</Text>
                    </View>
                    <Text
                      style={[styles.txAmount, { color: t.amount > 0 ? colors.success : colors.danger }]}
                    >
                      {t.amount > 0 ? `+${t.amount}` : t.amount}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
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
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  scrollContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  hero: { borderRadius: radius.tile, padding: spacing.xl, alignItems: 'center' },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.bodySm, fontWeight: '700' },
  heroValue: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: -1 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.bodySm, fontWeight: '600' },
  heroStats: { flexDirection: 'row', marginTop: spacing.lg, gap: spacing.sm, alignSelf: 'stretch' },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.field,
    paddingVertical: spacing.sm,
  },
  heroStatValue: { color: '#fff', fontSize: fontSize.title, fontWeight: '800' },
  heroStatLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.caption, fontWeight: '600', textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1.5,
  },
  iconChip: { width: 44, height: 44, borderRadius: radius.field, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: fontSize.body, fontWeight: '800' },
  cardBody: { fontSize: fontSize.bodySm, fontWeight: '500', lineHeight: 20, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.card },
  rowText: { flex: 1, fontSize: fontSize.bodySm, fontWeight: '700', lineHeight: 20 },
  sectionLabel: { fontSize: fontSize.caption, fontWeight: '800', letterSpacing: 0.8, marginTop: spacing.sm },
  list: { borderRadius: radius.card, paddingVertical: spacing.xs },
  howRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  howText: { flex: 1, fontSize: fontSize.bodySm, lineHeight: 20 },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  txLabel: { fontSize: fontSize.bodySm, fontWeight: '700' },
  txDate: { fontSize: fontSize.caption, marginTop: 2 },
  txAmount: { fontSize: fontSize.body, fontWeight: '900' },
  muted: { fontSize: fontSize.bodySm, textAlign: 'center' },
});
