import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { spacing, fontSize } from '@/components/ui/tokens';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = React.useState(true);
  React.useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => setIsOnline(!!state.isConnected));
    return () => unsub();
  }, []);
  if (isOnline) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Çevrimdışısınız — bazı özellikler çalışmayabilir</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#FF9500', padding: spacing.xs, alignItems: 'center' },
  text: { color: '#fff', fontSize: fontSize.bodySm, fontWeight: '600' },
});
