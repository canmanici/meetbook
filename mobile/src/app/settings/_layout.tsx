import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="trusted-contact" options={{ title: 'Güvendiğim Kişi' }} />
      <Stack.Screen name="data-export" options={{ title: 'Verilerimi İndir' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Hesabımı Sil' }} />
    </Stack>
  );
}
