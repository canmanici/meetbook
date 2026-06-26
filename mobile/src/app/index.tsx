import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useColorScheme } from 'react-native';

import { palette } from '@/components/ui/tokens';
import { useAuthStore } from '@/stores/auth-store';
import { useOnboardingStore } from '@/stores/onboarding-store';

export default function Index() {
  const status = useAuthStore((state) => state.status);
  const hasOnboarded = useOnboardingStore((state) => state.hasOnboarded);
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  // Wait until both auth bootstrap and onboarding flag have resolved.
  // Redirecting to a screen that isn't mounted (because the layout's
  // Stack.Protected guards gate which group is active) leaves the app
  // stuck on a blank "index" screen.
  if (status === 'loading' || hasOnboarded === null) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!hasOnboarded) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href={status === 'authenticated' ? '/tabs/home' : '/auth/login'} />;
}
