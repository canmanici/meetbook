import { Stack } from 'expo-router';

export default function MeetupLayout() {
  return (
    <Stack>
      <Stack.Screen name="select-place" options={{ title: 'Buluşma Yeri Seç' }} />
    </Stack>
  );
}
