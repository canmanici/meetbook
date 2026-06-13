import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { Button, palette, spacing, fontSize } from '@/components/ui';
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
      />
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={styles.scanArea} />
        <Text style={styles.instruction}>
          ISBN barkodunu kareye hizalayın
        </Text>
      </View>
      {scanned && (
        <View style={styles.resultOverlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.resultText, { color: colors.text }]}>Bulundu!</Text>
        </View>
      )}
    </View>
  );
}

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
