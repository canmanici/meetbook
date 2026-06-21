/**
 * BookBottomSheet — spec §3.3 draggable bottom sheet.
 *
 * Four snap points: collapsed (~8%), peek (~18% DEFAULT), half (~45%), full (~92%).
 * - enableDynamicSizing = false (fixed snaps, no auto-grow)
 * - keyboardBehavior = "interactive" + keyboardBlurBehavior = "restore"
 * - enablePanDownToClose = false (sheet never fully closes)
 * - Backdrop: none (map stays visible above the sheet)
 *
 * Content mode switches by snap index:
 *   collapsed (0): handle only
 *   peek (1):     header + 2 horizontal mini-cards
 *   half (2):     header + vertical list cards (BottomSheetFlatList)
 *   full (3):     header + full scrollable list (BottomSheetFlatList)
 *
 * Theming: backgroundStyle + indicator switch on isDark (no white sheet in dark mode).
 */
import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetProps,
} from '@gorhom/bottom-sheet';
import { palette, spacing, fontSize, radius } from '../ui/tokens';

export type SnapPoint = 'collapsed' | 'peek' | 'half' | 'full';

// Snap point percentages (spec §3.3)
export const SNAP_PERCENTAGES = {
  collapsed: '8%',
  peek: '18%',
  half: '45%',
  full: '92%',
} as const;

// Default snap index = 1 (peek)
export const DEFAULT_SNAP_INDEX = 1;

interface BookBottomSheetProps<T> {
  snapIndex: number;
  onSnapChange: (index: number) => void;
  data: T[];
  /** Render compact mini-card for peek mode (horizontal scroll, 2 items). */
  renderMiniCard: ({ item }: { item: T }) => React.ReactElement;
  /** Render full list card for half/full mode (vertical list). */
  renderListCard: ({ item }: { item: T }) => React.ReactElement;
  header?: React.ReactElement;
  emptyComponent?: React.ReactElement;
  keyExtractor: (item: T) => string;
  isDark?: boolean;
  style?: ViewStyle;
  testID?: string;
}

function BookBottomSheet<T>({
  snapIndex,
  onSnapChange,
  data,
  renderMiniCard,
  renderListCard,
  header,
  emptyComponent,
  keyExtractor,
  isDark = false,
  style,
  testID,
}: BookBottomSheetProps<T>) {
  const sheetRef = useRef<React.ComponentRef<typeof BottomSheet>>(null);

  const snapPoints = useMemo(
    () => [SNAP_PERCENTAGES.collapsed, SNAP_PERCENTAGES.peek, SNAP_PERCENTAGES.half, SNAP_PERCENTAGES.full],
    [],
  );

  const handleChange = useCallback(
    (index: number) => {
      onSnapChange(index);
    },
    [onSnapChange],
  );

  const renderHeader = useCallback(() => {
    if (!header) return null;
    return <View style={styles.headerContainer}>{header}</View>;
  }, [header]);

  const renderEmpty = useCallback(() => {
    if (emptyComponent) return emptyComponent;
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette[isDark ? 'dark' : 'light'].textMuted }]}>
          Henüz kitap bulunamadı.
        </Text>
      </View>
    );
  }, [emptyComponent, isDark]);

  const theme = isDark ? 'dark' : 'light';
  const bgColor = palette[theme].surface;
  const indicatorColor = palette[theme].textMuted;

  // Peek mode: 2 horizontal mini-cards
  const renderPeekContent = useCallback(() => {
    const items = data.slice(0, 2);
    if (items.length === 0) return renderEmpty();
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.miniCardsContent}
        testID="sheet-peek-scroll"
      >
        {items.map((item) => (
          <React.Fragment key={keyExtractor(item)}>
            {renderMiniCard({ item })}
          </React.Fragment>
        ))}
      </ScrollView>
    );
  }, [data, keyExtractor, renderMiniCard, renderEmpty]);

  // Half/full mode: vertical list
  const renderListContent = useCallback(() => {
    return (
      <BottomSheetFlatList
        data={data}
        renderItem={renderListCard}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
        testID="sheet-list"
      />
    );
  }, [data, renderListCard, keyExtractor, renderEmpty]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={snapIndex}
      snapPoints={snapPoints}
      onChange={handleChange}
      enablePanDownToClose={false}
      enableOverDrag={false}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backgroundStyle={{ backgroundColor: bgColor, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }}
      handleIndicatorStyle={{ backgroundColor: indicatorColor, width: 36, height: 4, borderRadius: 2, marginTop: spacing.xs }}
      style={[styles.sheet, style]}
      testID={testID ?? 'book-bottom-sheet'}
    >
      {renderHeader()}
      {snapIndex <= 1 ? renderPeekContent() : renderListContent()}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    // Shadow applied via backgroundStyle; keep sheet style minimal
  },
  headerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  miniCardsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.body,
  },
});

export default BookBottomSheet;
