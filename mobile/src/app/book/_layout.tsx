import { Stack } from 'expo-router';

export default function BookLayout() {
  return (
    <Stack>
      <Stack.Screen name="new" options={{ title: 'Kitap Ekle' }} />
      <Stack.Screen name="location-picker" options={{ title: 'Konum Seç' }} />
      <Stack.Screen name="scan-isbn" options={{ title: 'ISBN Tara' }} />
      <Stack.Screen name="shelf-scan" options={{ title: 'Rafı Tara' }} />
      {/* The detail screen draws its own back / favourite / share buttons over
          the cover — a header on top of that showed two back arrows. */}
      <Stack.Screen name="[id]" options={{ title: 'Kitap', headerShown: false }} />
    </Stack>
  );
}
