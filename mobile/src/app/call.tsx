/**
 * Full-screen call UI — outgoing / incoming / active, audio + video.
 *
 * Purely presentational over `useCallStore`; navigation in/out is driven by
 * <CallManager /> in the root layout. Closes itself when the call returns
 * to idle.
 */
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { spacing, fontSize, radius } from '@/components/ui/tokens';
import { Avatar } from '@/components/ui/avatar';
import { useCallStore, type CallQuality } from '@/stores/call-store';
import { getWebRTC } from '@/lib/webrtc';

function formatDuration(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const mm = m >= 60 ? `${Math.floor(m / 60)}:${(m % 60).toString().padStart(2, '0')}` : `${m}`;
  return `${mm}:${s.toString().padStart(2, '0')}`;
}

const QUALITY_CYCLE: CallQuality[] = ['auto', 'low', 'medium', 'high'];
const QUALITY_LABEL: Record<CallQuality, string> = {
  auto: 'Otomatik',
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
};

/** Three-bar link-health indicator driven by live WebRTC stats. */
function SignalBars({ quality }: { quality: 'good' | 'fair' | 'poor' }) {
  const active = quality === 'good' ? 3 : quality === 'fair' ? 2 : 1;
  const color = quality === 'good' ? '#34C759' : quality === 'fair' ? '#FFB020' : '#E5484D';
  return (
    <View style={styles.signalBars} accessibilityLabel={`Bağlantı: ${quality === 'good' ? 'iyi' : quality === 'fair' ? 'orta' : 'zayıf'}`}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.signalBar,
            { height: 4 + i * 3, backgroundColor: i <= active ? color : 'rgba(255,255,255,0.25)' },
          ]}
        />
      ))}
    </View>
  );
}

const END_REASON_LABEL: Record<string, string> = {
  ended: 'Arama sona erdi',
  rejected: 'Arama reddedildi',
  missed: 'Cevap yok',
  busy: 'Meşgul',
  unavailable: 'Ulaşılamıyor',
  failed: 'Bağlantı kurulamadı',
  cancelled: 'Arama iptal edildi',
  'permission-denied': 'Mikrofon/kamera izni verilmedi',
  'permission-blocked': 'Mikrofon/kamera izni engellendi',
};

export default function CallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const status = useCallStore((s) => s.status);
  const kind = useCallStore((s) => s.kind);
  const remoteRinging = useCallStore((s) => s.remoteRinging);
  const peer = useCallStore((s) => s.peer);
  const endReason = useCallStore((s) => s.endReason);
  const isMuted = useCallStore((s) => s.isMuted);
  const isSpeakerOn = useCallStore((s) => s.isSpeakerOn);
  const isCameraOn = useCallStore((s) => s.isCameraOn);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const startedAt = useCallStore((s) => s.startedAt);
  const quality = useCallStore((s) => s.quality);
  const networkQuality = useCallStore((s) => s.networkQuality);
  const {
    acceptCall, rejectCall, endCall, toggleMute, toggleSpeaker,
    toggleCamera, switchCamera, setQuality,
  } = useCallStore.getState();

  const cycleQuality = () => {
    const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(quality) + 1) % QUALITY_CYCLE.length];
    setQuality(next);
  };

  // Leave the screen once the call fully resets.
  useEffect(() => {
    if (status === 'idle' && router.canGoBack()) router.back();
  }, [status, router]);

  // Permanently-blocked mic/camera permission can't show the OS popup again —
  // point the user at Settings instead.
  useEffect(() => {
    if (status === 'ended' && endReason === 'permission-blocked') {
      Alert.alert(
        'İzin gerekli',
        'Arama yapabilmek için mikrofon ve kamera izni gerekiyor. Ayarlardan izin verebilirsin.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Ayarları Aç', onPress: () => Linking.openSettings() },
        ],
      );
    }
  }, [status, endReason]);

  // Duration ticker
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Pulsing rings while ringing
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status === 'outgoing' || status === 'incoming' || status === 'connecting') {
      const loop = Animated.loop(
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [status, pulse]);

  const rtc = getWebRTC();
  const RTCView = rtc?.RTCView;
  const showRemoteVideo = kind === 'video' && status === 'active' && remoteStream && RTCView;
  const showLocalVideo = kind === 'video' && localStream && isCameraOn && RTCView;

  const statusText =
    status === 'outgoing' ? (remoteRinging ? 'Çalıyor…' : 'Aranıyor…')
    : status === 'incoming' ? (kind === 'video' ? 'Gelen görüntülü arama' : 'Gelen sesli arama')
    : status === 'connecting' ? 'Bağlanıyor…'
    : status === 'active' && startedAt ? formatDuration(startedAt, now)
    : status === 'ended' ? (END_REASON_LABEL[endReason ?? 'ended'] ?? 'Arama sona erdi')
    : '';

  const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  return (
    <View style={styles.root}>
      {/* Backdrop: remote video when active video call, gradient otherwise */}
      {showRemoteVideo ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
        />
      ) : (
        <LinearGradient
          colors={['#0B3D33', '#11806B', '#0B2B25']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Dim scrim so text stays readable over video */}
      {showRemoteVideo ? <View style={styles.scrim} pointerEvents="none" /> : null}

      {/* ---- Top: peer identity ---- */}
      <View style={[styles.topArea, { paddingTop: insets.top + spacing.xl }]}>
        {!showRemoteVideo && (
          <View style={styles.avatarWrap}>
            {(status === 'outgoing' || status === 'incoming' || status === 'connecting') && (
              <>
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                      transform: [
                        { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
                      ],
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }),
                      transform: [
                        { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) },
                      ],
                    },
                  ]}
                />
              </>
            )}
            <Avatar name={peer.name || '?'} imageUrl={peer.avatarUrl ?? undefined} size="large" />
          </View>
        )}
        <Text style={styles.peerName} numberOfLines={1}>{peer.name}</Text>
        <View style={styles.statusRow}>
          {status === 'active' && <SignalBars quality={networkQuality} />}
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        {status === 'active' && networkQuality === 'poor' && (
          <Text style={styles.poorNetworkHint}>Bağlantı zayıf — görüntü kalitesi düşürüldü</Text>
        )}
        {kind === 'video' && status !== 'active' && (
          <View style={styles.kindBadge}>
            <Ionicons name="videocam" size={13} color="#ffffff" />
            <Text style={styles.kindBadgeText}>Görüntülü</Text>
          </View>
        )}
      </View>

      {/* ---- Local video PiP ---- */}
      {showLocalVideo ? (
        <View style={[styles.pip, { top: insets.top + spacing.md }]}>
          <RTCView
            streamURL={localStream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror
            zOrder={1}
          />
        </View>
      ) : null}

      {/* ---- Bottom controls ---- */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>
        {status === 'incoming' ? (
          <View style={styles.incomingRow}>
            <View style={styles.incomingAction}>
              <TouchableOpacity
                style={[styles.bigBtn, styles.rejectBtn]}
                onPress={() => { haptic(); rejectCall(); }}
                accessibilityRole="button"
                accessibilityLabel="Aramayı reddet"
                testID="call-reject"
              >
                <Ionicons name="close" size={32} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Reddet</Text>
            </View>
            <View style={styles.incomingAction}>
              <TouchableOpacity
                style={[styles.bigBtn, styles.acceptBtn]}
                onPress={() => { haptic(); void acceptCall(); }}
                accessibilityRole="button"
                accessibilityLabel="Aramayı kabul et"
                testID="call-accept"
              >
                <Ionicons name={kind === 'video' ? 'videocam' : 'call'} size={30} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Kabul Et</Text>
            </View>
          </View>
        ) : status === 'ended' ? null : (
          <>
            <View style={styles.controlRow}>
              <TouchableOpacity
                style={[styles.ctrlBtn, isMuted && styles.ctrlBtnActive]}
                onPress={() => { haptic(); toggleMute(); }}
                accessibilityRole="button"
                accessibilityLabel={isMuted ? 'Sesi aç' : 'Sesi kapat'}
                testID="call-mute"
              >
                <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color="#ffffff" />
              </TouchableOpacity>

              {kind === 'audio' ? (
                <TouchableOpacity
                  style={[styles.ctrlBtn, isSpeakerOn && styles.ctrlBtnActive]}
                  onPress={() => { haptic(); toggleSpeaker(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Hoparlör"
                  testID="call-speaker"
                >
                  <Ionicons name={isSpeakerOn ? 'volume-high' : 'volume-medium'} size={24} color="#ffffff" />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.ctrlBtn, !isCameraOn && styles.ctrlBtnActive]}
                    onPress={() => { haptic(); toggleCamera(); }}
                    accessibilityRole="button"
                    accessibilityLabel={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
                    testID="call-camera"
                  >
                    <Ionicons name={isCameraOn ? 'videocam' : 'videocam-off'} size={24} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => { haptic(); switchCamera(); }}
                    accessibilityRole="button"
                    accessibilityLabel="Kamerayı çevir"
                    testID="call-flip"
                  >
                    <Ionicons name="camera-reverse" size={24} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ctrlBtn, quality !== 'auto' && styles.ctrlBtnActive]}
                    onPress={() => { haptic(); cycleQuality(); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Görüntü kalitesi: ${QUALITY_LABEL[quality]}`}
                    testID="call-quality"
                  >
                    <Ionicons name="speedometer-outline" size={22} color="#ffffff" />
                    <Text style={styles.ctrlBtnLabel}>{QUALITY_LABEL[quality]}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <TouchableOpacity
              style={[styles.bigBtn, styles.rejectBtn, { marginTop: spacing.lg }]}
              onPress={() => { haptic(); endCall(); }}
              accessibilityRole="button"
              accessibilityLabel="Aramayı sonlandır"
              testID="call-end"
            >
              <Ionicons name="call" size={30} color="#ffffff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B2B25' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  topArea: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  avatarWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.xl,
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  peerName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    maxWidth: '85%',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  statusText: {
    fontSize: fontSize.body,
    color: 'rgba(255,255,255,0.85)',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  kindBadgeText: {
    color: '#ffffff',
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  pip: {
    position: 'absolute',
    right: spacing.md,
    width: 108,
    height: 156,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#000000',
  },
  controls: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  controlRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  ctrlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  ctrlBtnLabel: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 2,
  },
  signalBar: {
    width: 3,
    borderRadius: 1.5,
  },
  poorNetworkHint: {
    color: '#FFB020',
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  bigBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  rejectBtn: { backgroundColor: '#E5484D' },
  acceptBtn: { backgroundColor: '#34C759' },
  incomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignSelf: 'stretch',
  },
  incomingAction: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
});
