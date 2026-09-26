import { useEffect, useRef } from 'react';
import {
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { formatBytes, installedVersionName, updatesSupported } from '@/lib/app-update';
import { useUpdateStore } from '@/stores/update-store';

/**
 * Checks for a new APK on launch and when the app returns to the foreground,
 * then shows the update dialog (download progress → Android installer).
 * Mounted once in the root layout, independent of login state.
 */
export function UpdateManager() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const { release, mandatory, phase, progress, error, notice, withdrawn, check, startUpdate, install, dismiss } =
    useUpdateStore();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!updatesSupported) return;
    // Let the first screen settle before hitting the network.
    const t = setTimeout(() => check('auto'), 3000);
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') check('auto');
      appState.current = next;
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [check]);

  if (!updatesSupported || phase === 'idle') return null;

  // Emergency: this build was withdrawn and no fix is published yet.
  if (phase === 'warning') {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.float]} testID="update-warning">
            <View style={[styles.icon, { backgroundColor: colors.warning + '22' }]}>
              <Ionicons name="warning-outline" size={30} color={colors.warning} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              {withdrawn ? 'Bu sürümde bir sorun var' : 'Bu sürüm artık desteklenmiyor'}
            </Text>
            <Text style={[styles.sub, { color: colors.textMuted }]}>Sürüm {installedVersionName()}</Text>
            {notice ? (
              <View style={[styles.notes, { backgroundColor: colors.warning + '14' }]}>
                <Text style={[styles.notesText, { color: colors.text }]}>{notice}</Text>
              </View>
            ) : null}
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Düzeltilmiş sürüm yayınlanınca sana hemen güncelleme önereceğiz.
            </Text>
            <Button onPress={dismiss} testID="update-warning-ok">
              Anladım
            </Button>
          </View>
        </View>
      </Modal>
    );
  }

  if (!release) return null;
  const pct = Math.round(progress * 100);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !mandatory && dismiss()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.float]} testID="update-dialog">
          <View style={[styles.icon, { backgroundColor: colors.primary + '1A' }]}>
            <Ionicons name="cloud-download-outline" size={30} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            {mandatory ? 'Güncelleme gerekli' : 'Yeni sürüm hazır'}
          </Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>
            {installedVersionName()} → {release.version_name} · {formatBytes(release.size_bytes)}
          </Text>

          {notice ? (
            <View style={[styles.notes, { backgroundColor: colors.warning + '14' }]}>
              <Text style={[styles.notesText, { color: colors.text }]}>⚠️ {notice}</Text>
            </View>
          ) : null}

          {release.changelog ? (
            <ScrollView style={[styles.notes, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.notesText, { color: colors.text }]}>{release.changelog}</Text>
            </ScrollView>
          ) : null}

          {mandatory && (
            <Text style={[styles.hint, { color: colors.warning }]}>
              Bu sürüm zorunlu. Devam etmek için güncellemen gerekiyor.
            </Text>
          )}

          {phase === 'downloading' && (
            <View style={styles.progressWrap}>
              <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
                <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
              </View>
              <Text style={[styles.hint, { color: colors.textMuted }]}>İndiriliyor… %{pct}</Text>
            </View>
          )}

          {phase === 'error' && error && (
            <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
          )}

          {phase === 'ready' ? (
            <Button onPress={install} testID="update-install">
              Yükle
            </Button>
          ) : (
            <Button
              onPress={startUpdate}
              loading={phase === 'downloading'}
              disabled={phase === 'downloading'}
              testID="update-now"
            >
              {phase === 'error' ? 'Tekrar dene' : 'Şimdi güncelle'}
            </Button>
          )}
          {phase === 'ready' && (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Android yükleme ekranı açılmazsa “Yükle”ye tekrar dokun.
            </Text>
          )}

          {!mandatory && (
            <TouchableOpacity onPress={dismiss} style={styles.later} testID="update-later">
              <Text style={[styles.laterText, { color: colors.textMuted }]}>
                {phase === 'downloading' ? 'İptal' : 'Sonra'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { borderRadius: radius.card, padding: spacing.xl, gap: spacing.md, alignItems: 'stretch' },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: fontSize.title, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: fontSize.bodySm, textAlign: 'center' },
  notes: { maxHeight: 160, borderRadius: radius.field, padding: spacing.md },
  notesText: { fontSize: fontSize.bodySm, lineHeight: 20 },
  hint: { fontSize: fontSize.caption, textAlign: 'center' },
  progressWrap: { gap: spacing.xs },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  later: { alignItems: 'center', paddingVertical: spacing.xs },
  laterText: { fontSize: fontSize.bodySm, fontWeight: '700' },
});
