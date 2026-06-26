import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, fontSize, radius } from '@/components/ui/tokens';
import { Button } from '@/components/ui/button';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface Slide {
  icon: IconName;
  title: string;
  text: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'book',
    title: 'Kitaplarını Paylaş',
    text: 'Okuduğun kitapları yakınındaki kişilerle takas et.',
  },
  {
    icon: 'shield-checkmark',
    title: 'Güvenli Buluşmalar',
    text: 'Onaylanmış kafe, kütüphane ve parklarda buluşun. Güvenlik her şeyden önce gelir.',
  },
  {
    icon: 'location',
    title: 'Konum İzni',
    text: 'Yakınındaki kitapları bulmak için konumuna ihtiyacımız var.',
  },
];

export default function OnboardingScreen() {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [activeIndex, setActiveIndex] = useState(0);
  const [requesting, setRequesting] = useState(false);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const handleFinish = async () => {
    setRequesting(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      await AsyncStorage.setItem('hasOnboarded', 'true');
      router.replace('/tabs/home');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <LinearGradient
      colors={[colors.primarySoft, colors.background]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View
            key={slide.title}
            style={[styles.slide, { width, paddingTop: insets.top + spacing.xxxl }]}
          >
            <View style={[styles.iconBadge, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={slide.icon} size={64} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{slide.title}</Text>
            <Text style={[styles.text, { color: colors.textMuted }]}>
              {slide.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex && styles.dotActive,
                {
                  backgroundColor:
                    i === activeIndex ? colors.primary : colors.border,
                },
              ]}
            />
          ))}
        </View>

        {activeIndex === SLIDES.length - 1 && (
          <Button
            onPress={handleFinish}
            loading={requesting}
            testID="onboarding-finish-button"
            style={styles.action}
          >
            İzin Ver ve Başla
          </Button>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  iconBadge: {
    width: 132,
    height: 132,
    borderRadius: radius.tile + 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
    letterSpacing: 0.2,
  },
  text: {
    fontSize: fontSize.body,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  dotActive: {
    width: 24,
    height: 8,
  },
  action: {
    width: '100%',
  },
});
