import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { palette, radius, spacing, fontSize } from '@/components/ui';

export interface Photo {
  uri: string;
  type: string;
}

interface PhotoPickerProps {
  photos: Photo[];
  onPhotosChange: (photos: Photo[]) => void;
  maxPhotos?: number;
}

export function PhotoPicker({ photos, onPhotosChange, maxPhotos = 3 }: PhotoPickerProps) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const pickImage = async (useCamera: boolean) => {
    const permissionResult = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert('İzin gerekli', useCamera ? 'Kamera erişimi gerekli.' : 'Galeri erişimi gerekli.');
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsEditing: true,
          aspect: [3, 4],
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: maxPhotos - photos.length,
          allowsEditing: true,
          aspect: [3, 4],
        });

    if (!result.canceled && result.assets) {
      const newPhotos: Photo[] = result.assets.map((asset: any) => ({
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
      }));
      onPhotosChange([...photos, ...newPhotos].slice(0, maxPhotos));
    }
  };

  const removePhoto = (index: number) => {
    Alert.alert('Fotoğrafı sil', 'Bu fotoğrafı kaldırmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          const newPhotos = photos.filter((_, i) => i !== index);
          onPhotosChange(newPhotos);
        },
      },
    ]);
  };

  const movePhoto = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= photos.length) return;
    const newPhotos = [...photos];
    const [moved] = newPhotos.splice(fromIndex, 1);
    newPhotos.splice(toIndex, 0, moved);
    onPhotosChange(newPhotos);
  };

  const showOptions = () => {
    if (photos.length >= maxPhotos) {
      Alert.alert('Maksimum fotoğraf', `En fazla ${maxPhotos} fotoğraf ekleyebilirsiniz.`);
      return;
    }

    Alert.alert('Fotoğraf ekle', 'Fotoğraf kaynağını seçin', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Kamera', onPress: () => pickImage(true) },
      { text: 'Galeri', onPress: () => pickImage(false) },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>Fotoğraflar</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {photos.length === 0
          ? 'En az 1 fotoğraf gerekli'
          : `${photos.length}/${maxPhotos} fotoğraf`}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
        {photos.map((photo, index) => (
          <View key={photo.uri} style={styles.photoContainer}>
            <Image source={{ uri: photo.uri }} style={styles.photo} />
            {index === 0 && (
              <View style={[styles.mainBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.mainBadgeText}>Ana</Text>
              </View>
            )}
            <View style={styles.photoActions}>
              {index > 0 && (
                <Pressable
                  style={[styles.actionButton, { backgroundColor: colors.surface }]}
                  onPress={() => movePhoto(index, index - 1)}>
                  <Text style={[styles.actionText, { color: colors.text }]}>←</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.actionButton, { backgroundColor: colors.surface }]}
                onPress={() => removePhoto(index)}>
                <Text style={[styles.actionText, { color: colors.danger }]}>×</Text>
              </Pressable>
              {index < photos.length - 1 && (
                <Pressable
                  style={[styles.actionButton, { backgroundColor: colors.surface }]}
                  onPress={() => movePhoto(index, index + 1)}>
                  <Text style={[styles.actionText, { color: colors.text }]}>→</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        {photos.length < maxPhotos && (
          <Pressable
            style={[styles.addButton, { borderColor: colors.textMuted }]}
            onPress={showOptions}>
            <Text style={[styles.addButtonText, { color: colors.textMuted }]}>+</Text>
            <Text style={[styles.addButtonLabel, { color: colors.textMuted }]}>Ekle</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  hint: {
    fontSize: fontSize.bodySm,
    marginBottom: spacing.sm,
  },
  scroll: {
    flexDirection: 'row',
  },
  photoContainer: {
    marginRight: spacing.sm,
    position: 'relative',
  },
  photo: {
    width: 100,
    height: 133,
    borderRadius: radius.input,
  },
  mainBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.input,
  },
  mainBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  photoActions: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  actionButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  addButton: {
    width: 100,
    height: 133,
    borderRadius: radius.input,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 24,
    fontWeight: '600',
  },
  addButtonLabel: {
    fontSize: fontSize.bodySm,
    marginTop: 4,
  },
});
