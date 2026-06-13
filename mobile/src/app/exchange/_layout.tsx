import { Stack } from 'expo-router';

export default function ExchangeLayout() {
  return (
    <Stack>
      <Stack.Screen name="[id]" options={{ title: 'Takas Talebi' }} />
    </Stack>
  );
}
