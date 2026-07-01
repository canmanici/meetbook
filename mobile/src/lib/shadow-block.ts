import AsyncStorage from '@react-native-async-storage/async-storage';

const SHADOW_BLOCKED_KEY = 'shadow_blocked_users';

export async function getShadowBlocked(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SHADOW_BLOCKED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function isShadowBlocked(userId: string): Promise<boolean> {
  const list = await getShadowBlocked();
  return list.includes(userId);
}

export async function addShadowBlock(userId: string): Promise<void> {
  const list = await getShadowBlocked();
  if (!list.includes(userId)) {
    list.push(userId);
    await AsyncStorage.setItem(SHADOW_BLOCKED_KEY, JSON.stringify(list));
  }
}

export async function removeShadowBlock(userId: string): Promise<void> {
  const list = await getShadowBlocked();
  await AsyncStorage.setItem(
    SHADOW_BLOCKED_KEY,
    JSON.stringify(list.filter((id) => id !== userId)),
  );
}
