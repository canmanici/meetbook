import { Stack } from 'expo-router';

// Book clubs are backed by the API (src/lib/api/clubs.ts) — no local state here.
export default function ClubLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
