import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { EmptyState, palette, spacing, fontSize, radius } from '@/components/ui';

type RequestTab = 'sent' | 'received';

export default function RequestsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<RequestTab>('sent');

  const tabs: { key: RequestTab; label: string }[] = [
    { key: 'sent', label: 'Gönderilen' },
    { key: 'received', label: 'Alınan' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[
                  styles.tab,
                  isActive
                    ? { backgroundColor: colors.primary }
                    : { borderColor: colors.primary, borderWidth: 1 },
                ]}
                testID={`tab-${tab.key}`}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? colors.surface : colors.primary },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <View style={styles.content}>
        <EmptyState
          message="Henüz talep yok"
          description="Yakınındaki kitaplardan birini iste!"
          illustration={<Text style={styles.illustration}>📋</Text>}
          actionLabel="Kitaplara Göz At"
          onAction={() => {}}
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
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.input,
    alignItems: 'center',
  },
  tabText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  illustration: {
    fontSize: 64,
    marginBottom: spacing.xl,
  },
});
