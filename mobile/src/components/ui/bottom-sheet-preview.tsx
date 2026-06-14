import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { palette } from './tokens';

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
  const snapPoints = React.useMemo(() => ['45%'], []);
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <BottomSheet
      key={book?.id ?? 'closed'}
      index={book ? 0 : -1}
      snapPoints={snapPoints}
      onChange={(index) => {
        if (index === -1) onClose();
      }}
      enablePanDownToClose
      backgroundStyle={[styles.background, { backgroundColor: colors.surface }]}
      handleIndicatorStyle={[styles.indicator, { backgroundColor: colors.textMuted }]}
    >
      {book ? (
        <View style={styles.content}>
          <View style={styles.bookRow}>
            {book.coverUrl ? (
              <Image source={{ uri: book.coverUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, { backgroundColor: colors.textMuted + '30' }]} />
            )}
            <View style={styles.info}>
              <Text style={[styles.title, { color: colors.text }]}>{book.title}</Text>
              <Text style={[styles.author, { color: colors.textMuted }]}>{book.author}</Text>
              <View style={styles.tags}>
                <View style={[styles.tag, { backgroundColor: colors.textMuted + '20' }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>{book.condition}</Text>
                </View>
                <View style={[styles.tag, { backgroundColor: colors.textMuted + '20' }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>{book.category}</Text>
                </View>
              </View>
              <Text style={[styles.distance, { color: colors.primary }]}>{book.distanceKm.toFixed(1)} km</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => onRequestExchange(book.id)}
            >
              <Text style={[styles.primaryBtnText, { color: colors.surface }]}>Takas İste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { backgroundColor: colors.textMuted + '20' }]}
              onPress={() => onViewDetail(book.id)}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Detay</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    borderRadius: 20,
  },
  indicator: {
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
  info: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  author: {
    fontSize: 14,
    marginTop: 2,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  distance: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  primaryBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
