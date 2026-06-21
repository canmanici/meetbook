import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';

type TabKey = 'active' | 'completed';

interface CollapsingHeaderProps {
  activeCount: number;
  completedCount: number;
  totalCount: number;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  collapsed?: boolean;
}

export function CollapsingHeader({
  activeCount,
  completedCount,
  totalCount,
  activeTab,
  onTabChange,
  collapsed,
}: CollapsingHeaderProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; count: number }[] = [
    { key: 'active', label: 'Aktif', icon: 'checkmark-circle', count: activeCount },
    { key: 'completed', label: 'Takas Edilen', icon: 'swap-horizontal', count: completedCount },
  ];

  return (
    <View>
      <View style={styles.headerSection}>
        <Text style={[styles.title, { color: colors.text }]}>
          Kitaplarım
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {totalCount} kitap · {activeCount} aktif · {completedCount} takasta
        </Text>
      </View>

      <View style={[styles.tabRow, { backgroundColor: colors.surfaceAlt }]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[styles.tab, isActive && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${tab.label} — ${tab.count} kitap`}
            >
              {isActive && (
                <LinearGradient
                  colors={[colors.primary, colors.primary + 'DD']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.tabGradient}
                />
              )}
              <Ionicons
                name={tab.icon}
                size={15}
                color={isActive ? '#fff' : colors.textMuted}
                style={styles.tabIcon}
              />
              <Text style={[styles.tabText, { color: isActive ? '#fff' : colors.textMuted }]}>
                {tab.label}
              </Text>
              <View style={[styles.tabBadge, { backgroundColor: isActive ? '#fff' : colors.surface }]}>
                <Text style={[styles.tabBadgeText, { color: isActive ? colors.primary : colors.textMuted }]}>
                  {tab.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: 2,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    borderRadius: radius.button,
    padding: 3,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.button - 2,
    overflow: 'hidden',
    minHeight: 44,
  },
  tabActive: {
    shadowColor: '#11806B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  tabGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.button - 2,
  },
  tabIcon: {
    marginRight: 5,
  },
  tabText: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
  tabBadge: {
    marginLeft: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
});
