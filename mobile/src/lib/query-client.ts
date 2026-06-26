import { QueryClient, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

export const queryClient = new QueryClient();

// v5 renamed setOnlineState → setOnline
onlineManager.setOnline(false);

NetInfo.addEventListener((state) => {
  onlineManager.setOnline(!!state.isConnected);
});
