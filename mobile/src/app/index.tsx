import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useColorScheme } from 'react-native';

import { palette } from '@/components/ui/tokens';
import { useAuthStore } from '@/stores/auth-store';

export default function Index() {
  const status = useAuthStore((state) => state.status);
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  if (status === 'loading') {
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

  return <Redirect href={status === 'authenticated' ? '/tabs/home' : '/auth/login'} />;
}
