import React, { useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import BottomSheet, {
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, spacing, fontSize, radius, shadows } from "../ui/tokens";

export type SnapPoint = "collapsed" | "peek" | "half" | "full";

const SNAP_POINTS: Record<SnapPoint, string> = {
  collapsed: "8%",
  peek: "18%",
  half: "50%",
  full: "90%",
};

interface BookBottomSheetProps<T> {
  snapIndex: number;
  onSnapChange: (index: number) => void;
  data: T[];
  renderItem: ({ item }: { item: T }) => React.ReactElement;
  header?: React.ReactElement;
  emptyComponent?: React.ReactElement;
  keyExtractor: (item: T) => string;
  style?: ViewStyle;
}

function BookBottomSheet<T>({
  snapIndex,
  onSnapChange,
  data,
  renderItem,
  header,
  emptyComponent,
  keyExtractor,
  style,
}: BookBottomSheetProps<T>) {
  const sheetRef = useRef<React.ComponentRef<typeof BottomSheet>>(null);
  const insets = useSafeAreaInsets();

  const snapPoints = useMemo(
    () => [
      SNAP_POINTS.collapsed,
      SNAP_POINTS.peek,
      SNAP_POINTS.half,
      SNAP_POINTS.full,
    ],
    []
  );

  const handleChange = useCallback(
    (index: number) => {
      onSnapChange(index);
    },
    [onSnapChange]
  );

  const renderHeader = useCallback(() => {
    if (!header) return null;
    return <View style={styles.headerContainer}>{header}</View>;
  }, [header]);

  const renderEmpty = useCallback(() => {
    if (emptyComponent) return emptyComponent;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Henüz kitap bulunamadı.</Text>
      </View>
    );
  }, [emptyComponent]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={snapIndex}
      snapPoints={snapPoints}
      onChange={handleChange}
      enablePanDownToClose={false}
      enableOverDrag={false}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
      style={[styles.sheet, style]}
    >
      {renderHeader()}
      <BottomSheetFlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    ...shadows.sheet,
  },
  background: {
    backgroundColor: palette.light.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  indicator: {
    backgroundColor: palette.light.textMuted,
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.xs,
  },
  headerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    paddingVertical: spacing.xl * 2,
    alignItems: "center",
  },
  emptyText: {
    fontSize: fontSize.body,
    color: palette.light.textMuted,
  },
});

export default BookBottomSheet;
