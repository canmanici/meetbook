import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';

import { Button, palette, spacing, fontSize, radius, shadows } from '@/components/ui';
import { useBookDraftStore } from '@/stores/book-draft-store';

type BarcodeScanResult = {
  type: string;
  data: string;
};

export default function ScanISBNScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualISBN, setManualISBN] = useState('');
  const [manualError, setManualError] = useState('');
  const setScannedISBN = useBookDraftStore((state) => state.setScannedISBN);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarcodeScanned = (result: BarcodeScanResult) => {
    if (scanned) return;

    const data = result.data;
    // Validate ISBN-10 or ISBN-13 format
    const isbn10 = /^(?:\d[\ |-]?){9}[\d|X]$/i;
    const isbn13 = /^(?:\d[\ |-]?){13}$/;

    if (isbn10.test(data) || isbn13.test(data)) {
      setScanned(true);
      setScannedISBN(data.replace(/[\ |-]/g, ''));
      router.back();
    }
  };

  const submitManualISBN = () => {
    const cleaned = manualISBN.replace(/[- ]/g, '');
    const isValidISBN = /^\d{9}[\dX]$/.test(cleaned) || /^\d{13}$/.test(cleaned);
    if (isValidISBN) {
      setScanned(true);
      setScannedISBN(cleaned);
      router.back();
    } else {
      setManualError('Geçerli bir ISBN girin');
    }
  };

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
          Kitap barkodunu tarayabilmek için kamera izni gerekiyor.
        </Text>
        <Button onPress={requestPermission} testID="request-camera-permission">
          Kamera İzni Ver
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        enableTorch={torch}
      />
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={styles.scanArea} />
        <Text style={styles.instruction}>
          ISBN barkodunu kareye hizalayın
        </Text>
      </View>

      {/* Flashlight toggle — top-right circular glass button */}
      <TouchableOpacity
        onPress={() => setTorch((v) => !v)}
        testID="torch-toggle"
        style={styles.cornerButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={torch ? 'flashlight' : 'flashlight-outline'}
          size={22}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      {!manualMode && !scanned && (
        <TouchableOpacity
          onPress={() => setManualMode(true)}
          testID="manual-isbn-button"
          style={styles.manualButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="create-outline" size={18} color="#FFFFFF" />
          <Text style={styles.manualButtonText}>Manuel ISBN Gir</Text>
        </TouchableOpacity>
      )}

      {manualMode && !scanned && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.manualSheetWrap}
        >
          <View style={[styles.manualSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.manualTitle, { color: colors.text }]}>
              ISBN Manuel Giriş
            </Text>
            <TextInput
              style={[
                styles.manualInput,
                {
                  borderColor: manualError ? colors.danger : colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="örn. 9781234567890"
              placeholderTextColor={colors.textMuted}
              value={manualISBN}
              onChangeText={(text) => {
                setManualISBN(text);
                if (manualError) setManualError('');
              }}
              keyboardType="number-pad"
              autoCapitalize="characters"
              autoFocus
              testID="manual-isbn-input"
            />
            {!!manualError && (
              <Text style={[styles.manualError, { color: colors.danger }]}>
                {manualError}
              </Text>
            )}
            <View style={styles.manualActions}>
              <TouchableOpacity
                onPress={() => {
                  setManualMode(false);
                  setManualISBN('');
                  setManualError('');
                }}
                testID="manual-isbn-cancel"
                style={[styles.manualActionBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.manualActionText, { color: colors.text }]}>
                  İptal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitManualISBN}
                testID="manual-isbn-submit"
                style={[
                  styles.manualActionBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              >
                <Text style={[styles.manualActionText, { color: '#FFFFFF' }]}>
                  Ekle
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {scanned && (
        <View style={styles.resultOverlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.resultText, { color: colors.text }]}>Bulundu!</Text>
        </View>
      )}
    </View>
  );
}

const CORNER_BTN_SIZE = 48;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
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
  },
  scanArea: {
    width: 280,
    height: 180,
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  instruction: {
    color: 'white',
    fontSize: fontSize.body,
    marginTop: spacing.md,
    textAlign: 'center',
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
  manualButton: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.field,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    ...shadows.float,
  },
  manualButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  manualSheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  manualSheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    ...shadows.float,
  },
  manualTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  manualInput: {
    borderWidth: 1.5,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  manualError: {
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  manualActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  manualActionBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.field,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  manualActionText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    fontSize: fontSize.heading,
    fontWeight: '600',
    marginTop: spacing.md,
  },
});
