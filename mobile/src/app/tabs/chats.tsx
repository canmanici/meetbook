import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { EmptyState, palette, spacing, fontSize } from '@/components/ui';

export default function ChatsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Sohbetler
        </Text>
      </View>
      <View style={styles.content}>
        <EmptyState
          message="Henüz sohbet yok"
          description="Bir kitap talebi kabul edildiğinde burada görünür"
          illustration={<Text style={styles.illustration}>💬</Text>}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  illustration: {
    fontSize: 64,
    marginBottom: spacing.xl,
  },
});
