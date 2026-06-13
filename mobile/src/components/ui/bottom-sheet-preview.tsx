import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';

export interface BookPreviewData {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  condition: string;
  distanceKm: number;
  category: string;
}

interface BottomSheetPreviewProps {
  book: BookPreviewData | null;
  onClose: () => void;
  onRequestExchange: (bookId: string) => void;
  onViewDetail: (bookId: string) => void;
}

export function BottomSheetPreview({
  book,
  onClose,
  onRequestExchange,
  onViewDetail,
}: BottomSheetPreviewProps) {
  const sheetRef = React.useRef<BottomSheet>(null);
  const snapPoints = React.useMemo(() => ['45%'], []);

  React.useEffect(() => {
    if (book) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [book]);

  if (!book) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <View style={styles.content}>
        <View style={styles.bookRow}>
          {book.coverUrl ? (
            <Image source={{ uri: book.coverUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.placeholder]} />
          )}
          <View style={styles.info}>
            <Text style={styles.title}>{book.title}</Text>
            <Text style={styles.author}>{book.author}</Text>
            <View style={styles.tags}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{book.condition}</Text>
              </View>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{book.category}</Text>
              </View>
            </View>
            <Text style={styles.distance}>{book.distanceKm.toFixed(1)} km</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => onRequestExchange(book.id)}
          >
            <Text style={styles.primaryBtnText}>exchange İste</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => onViewDetail(book.id)}
          >
            <Text style={styles.secondaryBtnText}>Detay</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
  },
  indicator: {
    backgroundColor: '#d1d5db',
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  bookRow: {
    flexDirection: 'row',
    gap: 14,
  },
  cover: {
    width: 64,
    height: 88,
    borderRadius: 8,
  },
  placeholder: {
    backgroundColor: '#ddd',
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  author: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  distance: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F6E5D',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  primaryBtn: {
    flex: 2,
    backgroundColor: '#0F6E5D',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
  },
});
