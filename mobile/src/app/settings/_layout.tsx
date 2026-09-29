import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="credits" options={{ title: 'Kitap Kredim' }} />
      <Stack.Screen name="student-verification" options={{ title: 'Öğrenci Doğrulama' }} />
      <Stack.Screen name="teacher" options={{ title: 'Öğretmen Hesabı' }} />
      <Stack.Screen name="trusted-contact" options={{ title: 'Güvendiğim Kişi' }} />
      <Stack.Screen name="data-export" options={{ title: 'Verilerimi İndir' }} />
      <Stack.Screen name="data-deletion" options={{ title: 'Verilerimin Silinmesi' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Hesabımı Sil' }} />
    </Stack>
  );
}
