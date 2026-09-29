import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  Share,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input, Skeleton, palette, pastels, radius, spacing, fontSize } from '@/components/ui';
import { ChipSelect } from '@/components/chip-select';
import {
  activateTeacher,
  applyAsTeacher,
  getTeacherStatus,
  issueStudentCodes,
  listStudentCodes,
  revokeStudentCode,
  type StudentCode,
  type TeacherStatus,
} from '@/lib/api/teachers';
import { apiErrorDetail } from '@/lib/exchange-errors';

// What the badge means — and, just as important, what it doesn't.
const RULES: { icon: keyof typeof Ionicons.glyphMap; text: string; ok: boolean }[] = [
  { icon: 'ribbon', text: 'Profilinde ve taleplerde "Öğretmen" rozeti görünür.', ok: true },
  { icon: 'library', text: 'Ders kodlu kitaplarını öğrencilerle paylaşabilirsin.', ok: true },
  { icon: 'key', text: 'Öğrencilerine tek kullanımlık doğrulama kodu verebilirsin (en fazla 30 açık kod).', ok: true },
  { icon: 'cash-outline', text: 'Kitap satılamaz; fiyat, IBAN veya telefon içeren ilanlar kabul edilmez.', ok: false },
  { icon: 'trending-up', text: 'Rozet ilanlarını öne çıkarmaz, ekstra kredi vermez.', ok: false },
  { icon: 'eye-off', text: 'Hangi öğrencinin hangi kitabı aldığını göremezsin.', ok: false },
  { icon: 'flag', text: 'Şikâyet gelirse rozet incelenir ve geri alınabilir.', ok: false },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function applyErrorMessage(err: unknown): string {
  switch (apiErrorDetail(err)) {
    case 'TEACHER_APPLICATION_OPEN':
      return 'Zaten açık bir başvurun var.';
    case 'TEACHER_REVOKED':
      return 'Rozetin daha önce kaldırıldığı için yeni başvuru yapılamaz.';
    case 'TEACHER_REAPPLY_TOO_SOON':
      return 'Reddedilen başvurudan sonra 30 gün beklemelisin.';
    default:
      return 'Başvuru gönderilemedi. Bilgileri kontrol edip tekrar dene.';
  }
}

function StatusCard({ status, colors, tints }: { status: TeacherStatus; colors: any; tints: any }) {
  const app = status.application;
  if (status.is_teacher) {
    return (
      <View style={[styles.statusCard, { backgroundColor: tints.mint.bg }]} testID="teacher-approved">
        <Ionicons name="ribbon" size={24} color={tints.mint.ink} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { color: tints.mint.ink }]}>Öğretmen hesabın onaylı</Text>
          <Text style={[styles.statusBody, { color: tints.mint.ink }]}>{status.institution}</Text>
        </View>
      </View>
    );
  }
  if (!app) return null;
  const map = {
    pending: { tint: tints.butter, icon: 'time' as const, title: 'Başvurun inceleniyor', body: `${formatDate(app.created_at)} tarihinde gönderildi. Bir yönetici kontrol edip sonucu bildirecek.` },
    rejected: { tint: tints.coral, icon: 'close-circle' as const, title: 'Başvurun reddedildi', body: app.review_note ?? '' },
    revoked: { tint: tints.coral, icon: 'ban' as const, title: 'Öğretmen rozetin kaldırıldı', body: app.review_note ?? '' },
    approved: { tint: tints.mint, icon: 'ribbon' as const, title: 'Onaylandı', body: '' },
  }[app.status];
  return (
    <View style={[styles.statusCard, { backgroundColor: map.tint.bg }]} testID={`teacher-status-${app.status}`}>
      <Ionicons name={map.icon} size={24} color={map.tint.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.statusTitle, { color: map.tint.ink }]}>{map.title}</Text>
        {!!map.body && <Text style={[styles.statusBody, { color: map.tint.ink }]}>{map.body}</Text>}
        {app.status === 'rejected' && status.reapply_after && (
          <Text style={[styles.statusBody, { color: map.tint.ink }]}>
            {formatDate(status.reapply_after)} tarihinden sonra yeniden başvurabilirsin.
          </Text>
        )}
      </View>
    </View>
  );
}

const CODE_STATUS: Record<string, string> = {
  active: 'Kullanılabilir',
  redeemed: 'Kullanıldı',
  expired: 'Süresi doldu',
  revoked: 'İptal edildi',
};

/** Approved teachers: one-time codes that verify their students. */
function StudentCodes({ colors }: { colors: any }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['student-codes'], queryFn: listStudentCodes });
  const onDone = (next: Awaited<ReturnType<typeof listStudentCodes>>) => {
    setError(null);
    queryClient.setQueryData(['student-codes'], next);
  };
  const [days, setDays] = useState<'1' | '7' | '14' | '30'>('14');
  const [count, setCount] = useState<'1' | '5' | '10'>('5');
  const issue = useMutation({
    mutationFn: () => issueStudentCodes(Number(count), Number(days)),
    onSuccess: onDone,
    onError: (err) =>
      setError(
        apiErrorDetail(err) === 'CODE_LIMIT'
          ? 'En fazla 30 açık kodun olabilir. Kullanılmayanları iptal et ya da süresinin dolmasını bekle.'
          : 'Kod oluşturulamadı.',
      ),
  });
  const revoke = useMutation({ mutationFn: revokeStudentCode, onSuccess: onDone });
  const active = (data?.items ?? []).filter((c: StudentCode) => c.status === 'active');
  const used = (data?.items ?? []).filter((c: StudentCode) => c.status === 'redeemed').length;

  const shareCode = (c: StudentCode) =>
    Share.share({
      message: `MeetBook öğrenci kodun: ${c.code}\nUygulamada Profil → Kitap Kredim → "Öğrenci misin?" bölümüne gir. Tek kullanımlık, ${formatDate(c.expires_at)} tarihine kadar geçerli.`,
    });

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="teacher-codes">
      <Text style={[styles.cardTitle, { color: colors.text }]}>Öğrenci Kodları</Text>
      <Text style={[styles.cardBody, { color: colors.textMuted }]}>
        Her kod bir öğrenciyi doğrular ve tek kullanımlıktır. Sadece kendi öğrencilerine ver — kimin hangi kodla
        doğrulandığı kayıt altındadır.
      </Text>
      <Text style={[styles.cardBody, { color: colors.text }]} testID="teacher-codes-summary">
        {active.length} / {data?.max_active ?? 30} açık kod · {used} öğrenci doğrulandı
      </Text>
      {error && <Text style={[styles.error, { color: colors.danger }]} testID="teacher-codes-error">{error}</Text>}
      <ChipSelect
        label="Kaç kod?"
        options={['1', '5', '10'] as const}
        labels={{ '1': '1', '5': '5', '10': '10' }}
        value={count}
        onChange={setCount}
        testIDPrefix="codes-count"
      />
      <ChipSelect
        label="Geçerlilik"
        options={['1', '7', '14', '30'] as const}
        labels={{ '1': '1 gün', '7': '1 hafta', '14': '2 hafta', '30': '1 ay' }}
        value={days}
        onChange={setDays}
        testIDPrefix="codes-days"
      />
      <Button onPress={() => issue.mutate()} loading={issue.isPending} disabled={issue.isPending} testID="teacher-codes-issue">
        {`${count} kod oluştur`}
      </Button>
      {active.map((c: StudentCode) => (
        <View key={c.id} style={[styles.codeRow, { borderColor: colors.border }]} testID={`code-${c.code}`}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.codeText, { color: colors.text }]} selectable>{c.code}</Text>
            <Text style={[styles.statusBody, { color: colors.textMuted }]}>
              {CODE_STATUS[c.status]} · {formatDate(c.expires_at)} tarihine kadar
            </Text>
          </View>
          <TouchableOpacity onPress={() => shareCode(c)} accessibilityLabel={`${c.code} kodunu paylaş`} testID={`code-share-${c.code}`}>
            <Ionicons name="share-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => revoke.mutate(c.id)} accessibilityLabel={`${c.code} kodunu iptal et`} testID={`code-revoke-${c.code}`}>
            <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/** Pending applicant: enter the code an admin e-mailed to the work address. */
function ActivationCode({ colors, workEmail }: { colors: any; workEmail: string | null }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activate = useMutation({
    mutationFn: () => activateTeacher(code),
    onSuccess: (next) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.setQueryData(['teacher-status'], next);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) =>
      setError(
        apiErrorDetail(err) === 'TOO_MANY_ATTEMPTS'
          ? 'Çok fazla deneme. Bir saat sonra tekrar dene.'
          : 'Kod hatalı veya süresi dolmuş. 5 hatalı denemeden sonra kod iptal olur; yeni kod iste.',
      ),
  });
  const onChange = (raw: string) => {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="teacher-activation">
      <Text style={[styles.cardTitle, { color: colors.text }]}>Aktivasyon Kodu</Text>
      <Text style={[styles.cardBody, { color: colors.textMuted }]}>
        {workEmail
          ? `Başvurun incelenince ${workEmail} adresine bir aktivasyon kodu göndereceğiz. Kodu buraya gir.`
          : 'İş e-postana gönderilen aktivasyon kodunu buraya gir.'}
      </Text>
      <Input
        label="Kod"
        placeholder="ABCD-EFGH"
        value={code}
        onChangeText={onChange}
        autoCapitalize="characters"
        error={error ?? undefined}
        testID="teacher-activation-input"
      />
      <Button
        onPress={() => { setError(null); activate.mutate(); }}
        loading={activate.isPending}
        disabled={code.replace('-', '').length !== 8 || activate.isPending}
        testID="teacher-activation-submit"
      >
        Öğretmen hesabını etkinleştir
      </Button>
    </View>
  );
}

export default function TeacherScreen() {
  const isDark = useColorScheme() === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const tints = pastels[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: status, isLoading, isError, refetch } = useQuery({
    queryKey: ['teacher-status'],
    queryFn: getTeacherStatus,
  });

  const [institution, setInstitution] = useState('');
  const [department, setDepartment] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const applyMutation = useMutation({
    mutationFn: () =>
      applyAsTeacher({
        institution: institution.trim(),
        department: department.trim() || null,
        work_email: workEmail.trim(),
        profile_url: profileUrl.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['teacher-status'], next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err) => setError(applyErrorMessage(err)),
  });

  const submit = () => {
    setError(null);
    if (institution.trim().length < 2) {
      setError('Kurum adını yaz.');
      return;
    }
    if (profileUrl.trim() && !/^https?:\/\//i.test(profileUrl.trim())) {
      setError('Kadro sayfası bağlantısı http:// veya https:// ile başlamalı.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail.trim())) {
      setError('İş e-postanı yaz — aktivasyon kodunu oraya göndereceğiz.');
      return;
    }
    applyMutation.mutate();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { backgroundColor: colors.surface, paddingTop: insets.top + spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Öğretmen Hesabı</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxxl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <Skeleton variant="card" />
        ) : isError || !status ? (
          <View style={{ gap: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.textMuted }}>Durum yüklenemedi.</Text>
            <Button onPress={() => refetch()} testID="teacher-retry">Tekrar dene</Button>
          </View>
        ) : (
          <>
            <StatusCard status={status} colors={colors} tints={tints} />

            {status.is_teacher && <StudentCodes colors={colors} />}

            {!status.is_teacher && status.application?.status === 'pending' && (
              <ActivationCode colors={colors} workEmail={status.application.work_email} />
            )}

            {status.can_apply && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Başvuru</Text>
                <Text style={[styles.cardBody, { color: colors.textMuted }]}>
                  Kurumundaki iş e-postanı yaz. Bir yönetici başvurunu kontrol edip o adrese bir aktivasyon kodu gönderir; kodu bu ekrana girince öğretmen hesabın açılır.
                </Text>
                <Input label="Kurum" placeholder="Üniversite / okul adı" value={institution} onChangeText={setInstitution} testID="teacher-institution" />
                <Input label="Bölüm (opsiyonel)" placeholder="Matematik" value={department} onChangeText={setDepartment} testID="teacher-department" />
                <Input label="İş e-postası" placeholder="ad.soyad@universite.edu.tr" value={workEmail} onChangeText={setWorkEmail} keyboardType="email-address" testID="teacher-email" />
                <Input label="Kadro sayfası" placeholder="https://…" value={profileUrl} onChangeText={setProfileUrl} autoCapitalize="none" helper="Kurum sitesinde adının geçtiği sayfa — doğrulamayı hızlandırır." testID="teacher-url" />
                <Input label="Not (opsiyonel)" placeholder="Verdiğin dersler" value={note} onChangeText={setNote} testID="teacher-note" />
                {error && <Text style={[styles.error, { color: colors.danger }]} testID="teacher-error">{error}</Text>}
                <Button onPress={submit} loading={applyMutation.isPending} disabled={applyMutation.isPending} testID="teacher-submit">
                  Başvur
                </Button>
              </View>
            )}

            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>ÖĞRETMEN ROZETİ</Text>
            <View style={[styles.rules, { backgroundColor: colors.surface }]}>
              {RULES.map((r) => (
                <View key={r.text} style={styles.ruleRow}>
                  <Ionicons name={r.icon} size={18} color={r.ok ? colors.success : colors.danger} />
                  <Text style={[styles.ruleText, { color: colors.text }]}>{r.text}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  backButton: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.heading, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  statusCard: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.card, alignItems: 'flex-start' },
  statusTitle: { fontSize: fontSize.body, fontWeight: '800' },
  statusBody: { fontSize: fontSize.bodySm, marginTop: 2, lineHeight: 20 },
  card: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  cardTitle: { fontSize: fontSize.title, fontWeight: '800' },
  cardBody: { fontSize: fontSize.bodySm, lineHeight: 20 },
  error: { fontSize: fontSize.bodySm, fontWeight: '600' },
  sectionLabel: { fontSize: fontSize.caption, fontWeight: '800', letterSpacing: 0.8, marginTop: spacing.sm },
  rules: { borderRadius: radius.card, paddingVertical: spacing.xs },
  ruleRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  ruleText: { flex: 1, fontSize: fontSize.bodySm, lineHeight: 20 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1 },
  codeText: { fontSize: fontSize.title, fontWeight: '900', letterSpacing: 2 },
});
