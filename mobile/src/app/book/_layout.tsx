import { Stack } from 'expo-router';

export default function BookLayout() {
  return (
    <Stack>
      <Stack.Screen name="new" options={{ title: 'Kitap Ekle' }} />
      <Stack.Screen name="location-picker" options={{ title: 'Konum Seç' }} />
      <Stack.Screen name="scan-isbn" options={{ title: 'ISBN Tara' }} />
      <Stack.Screen name="shelf-scan" options={{ title: 'Rafı Tara' }} />
      <Stack.Screen name="[id]" options={{ title: 'Kitap' }} />
    </Stack>
  );
}
