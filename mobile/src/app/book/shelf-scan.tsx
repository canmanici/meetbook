import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import * as Location from 'expo-location';

import { Button, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { createBook, lookupISBN } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';

type BarcodeScanResult = {
  type: string;
  data: string;
};

type ScanStatus = 'pending' | 'adding' | 'done' | 'failed';

type ScannedBook = {
  id: string;
  isbn: string;
  status: ScanStatus;
  title?: string;
  bookId?: string;
};

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };

const ISBN10 = /^(?:\d[\ |-]?){9}[\d|X]$/i;
const ISBN13 = /^(?:\d[\ |-]?){13}$/;

function isValidISBN(data: string): boolean {
  return ISBN10.test(data) || ISBN13.test(data);
}

const STATUS_LABEL: Record<ScanStatus, string> = {
  pending: 'Bekliyor',
  adding: 'Ekleniyor...',
  done: 'Eklendi',
  failed: 'Eklenemedi',
};

export default function ShelfScanScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);

  const [scannedBooks, setScannedBooks] = useState<ScannedBook[]>([]);
  const scannedBooksRef = useRef<ScannedBook[]>([]);
  const scannedISBNsRef = useRef<Set<string>>(new Set());
  const idCounter = useRef(0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);

  const [bookLocation, setBookLocation] = useState<{ lat: number; lng: number } | null>(null);

  const setScannedISBN = useBookDraftStore((state) => state.setScannedISBN);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Resolve a location to use for every batch-created book.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) {
          setBookLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // keep null — ISTANBUL fallback used at create time
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const updateBooks = (updater: ScannedBook[] | ((prev: ScannedBook[]) => ScannedBook[])) => {
    setScannedBooks((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      scannedBooksRef.current = next;
      return next;
    });
  };

  const handleBarcodeScanned = (result: BarcodeScanResult) => {
    if (isProcessing) return;
    const data = result.data;
    if (!isValidISBN(data)) return;
    const cleaned = data.replace(/[\ |-]/g, '');
    if (scannedISBNsRef.current.has(cleaned)) return;
    scannedISBNsRef.current.add(cleaned);
    idCounter.current += 1;
    const id = `scan-${idCounter.current}`;
    updateBooks((prev) => [...prev, { id, isbn: cleaned, status: 'pending' }]);
  };

  const removeBook = (id: string, isbn: string) => {
    if (isProcessing) return;
    scannedISBNsRef.current.delete(isbn);
    updateBooks((prev) => prev.filter((b) => b.id !== id));
  };

  const clearAll = () => {
    if (isProcessing) return;
    scannedISBNsRef.current.clear();
    updateBooks([]);
  };

  const onFinish = async () => {
    const pending = scannedBooksRef.current.filter((b) => b.status === 'pending');
    if (pending.length === 0 || isProcessing) return;

    const location = bookLocation ?? { lat: ISTANBUL.latitude, lng: ISTANBUL.longitude };

    setIsProcessing(true);
    setTotalToProcess(pending.length);
    setProcessedCount(0);

    for (const item of pending) {
      updateBooks((prev) =>
        prev.map((b) => (b.id === item.id ? { ...b, status: 'adding' as ScanStatus } : b)),
      );
      try {
        const lookup = await lookupISBN(item.isbn);
        if (!lookup.title) {
          updateBooks((prev) =>
            prev.map((b) => (b.id === item.id ? { ...b, status: 'failed' as ScanStatus } : b)),
          );
        } else {
          const book = await createBook({
            title: lookup.title,
            author: lookup.author || undefined,
            isbn: item.isbn,
            description: lookup.description || undefined,
            category: 'other',
            language: 'tr',
            condition: 'good',
            location,
          });
          updateBooks((prev) =>
            prev.map((b) =>
              b.id === item.id
                ? { ...b, status: 'done' as ScanStatus, title: lookup.title, bookId: book.id }
                : b,
            ),
          );
        }
      } catch {
        updateBooks((prev) =>
          prev.map((b) => (b.id === item.id ? { ...b, status: 'failed' as ScanStatus } : b)),
        );
      } finally {
        setProcessedCount((c) => c + 1);
      }
    }

    setIsProcessing(false);
    await queryClient.invalidateQueries({ queryKey: ['books', 'me'] });

    const hasFailed = scannedBooksRef.current.some((b) => b.status === 'failed');
    if (!hasFailed) {
      router.replace('/tabs/my-books');
    }
  };

  const onManualAdd = (isbn: string) => {
    setScannedISBN(isbn);
    router.push('/book/new');
  };

  const pendingCount = scannedBooks.filter((b) => b.status === 'pending').length;
  const doneCount = scannedBooks.filter((b) => b.status === 'done').length;

  if (permission === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission?.granted) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.permissionText, { color: colors.text }]}>
          Rafı taramak için kamera izni gerekiyor.
        </Text>
        <Button onPress={requestPermission} testID="shelf-scan-request-camera">
          Kamera İzni Ver
        </Button>
      </View>
    );
  }

  const renderItem = ({ item }: { item: ScannedBook }) => {
    const statusColor =
      item.status === 'done'
        ? colors.success
        : item.status === 'failed'
          ? colors.danger
          : item.status === 'adding'
            ? colors.primary
            : colors.textMuted;

    return (
      <View style={[styles.itemRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title || `ISBN ${item.isbn}`}
          </Text>
          <Text style={[styles.itemStatus, { color: statusColor }]}>
            {STATUS_LABEL[item.status]}
            {item.status === 'failed' ? ' — ISBN bulunamadı' : ''}
          </Text>
        </View>
        {item.status === 'adding' && <ActivityIndicator size="small" color={colors.primary} />}
        {item.status === 'done' && (
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        )}
        {item.status === 'failed' && (
          <TouchableOpacity
            onPress={() => onManualAdd(item.isbn)}
            style={[styles.itemAction, { borderColor: colors.primary }]}
            testID={`shelf-scan-manual-${item.isbn}`}>
            <Text style={[styles.itemActionText, { color: colors.primary }]}>Manuel ekle</Text>
          </TouchableOpacity>
        )}
        {item.status === 'pending' && !isProcessing && (
          <TouchableOpacity
            onPress={() => removeBook(item.id, item.isbn)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID={`shelf-scan-remove-${item.isbn}`}>
            <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8'] }}
        onBarcodeScanned={handleBarcodeScanned}
        enableTorch={torch}
      />

      <View style={styles.overlay}>
        <View style={styles.scanArea} />
        <Text style={styles.instruction}>
          Kitap arka kapağındaki barkodu kareye hizalayın{'\n'}her barkot otomatik listeye eklenir
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => setTorch((v) => !v)}
        testID="shelf-scan-torch"
        style={styles.cornerButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View style={[styles.bottomPanel, { backgroundColor: colors.surface }]}>
        <View style={[styles.panelHeader, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.panelTitle, { color: colors.text }]}>
              Taranan kitaplar ({scannedBooks.length})
            </Text>
            <Text style={[styles.panelSubtitle, { color: colors.textMuted }]}>
              {doneCount > 0 ? `${doneCount} kitap eklendi` : 'Bitir’e basınca hepsi yayınlanır'}
            </Text>
          </View>
          {scannedBooks.length > 0 && !isProcessing && (
            <TouchableOpacity onPress={clearAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearText, { color: colors.textMuted }]}>Temizle</Text>
            </TouchableOpacity>
          )}
        </View>

        {isProcessing && (
          <View style={[styles.progressRow, { backgroundColor: colors.primarySoft }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.progressText, { color: colors.primary }]}>
              {processedCount}/{totalToProcess} kitap eklendi...
            </Text>
          </View>
        )}

        {scannedBooks.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="scan-outline" size={32} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Henüz barkod taranmadı.
            </Text>
          </View>
        ) : (
          <FlatList
            data={scannedBooks}
            keyExtractor={(b) => b.id}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            testID="shelf-scan-list"
          />
        )}

        <View style={styles.footer}>
          <Button
            onPress={onFinish}
            disabled={pendingCount === 0 || isProcessing}
            loading={isProcessing}
            testID="shelf-scan-finish">
            {isProcessing ? 'Ekleniyor' : `Bitir${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
          </Button>
        </View>
      </View>
    </View>
  );
}

const CORNER_BTN_SIZE = 48;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permissionText: {
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '38%',
  },
  scanArea: {
    width: 260,
    height: 160,
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  instruction: {
    color: 'white',
    fontSize: fontSize.bodySm,
    marginTop: spacing.md,
    textAlign: 'center',
    lineHeight: 20,
  },
  cornerButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    width: CORNER_BTN_SIZE,
    height: CORNER_BTN_SIZE,
    borderRadius: CORNER_BTN_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    ...shadows.float,
  },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '44%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...shadows.sheet,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  panelTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  panelSubtitle: {
    fontSize: fontSize.caption,
    marginTop: 2,
  },
  clearText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
  },
  progressText: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
  },
  itemStatus: {
    fontSize: fontSize.caption,
  },
  itemAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  itemActionText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.bodySm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
