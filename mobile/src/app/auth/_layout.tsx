import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { palette } from '@/components/ui';

export default function AuthLayout() {
  const colorScheme = useColorScheme();
  const colors = palette[colorScheme === 'dark' ? 'dark' : 'light'];
  return (
    <Stack
      screenOptions={{ headerShown: false }}
      initialRouteName="login"
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen
        name="forgot-password"
        options={{
          title: 'Şifre Sıfırla',
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          title: 'Yeni Şifre',
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
        }}
      />
    </Stack>
  );
}
