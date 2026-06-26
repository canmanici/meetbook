import { QueryClient, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

export const queryClient = new QueryClient();

onlineManager.setOnlineState(false);

NetInfo.addEventListener((state) => {
  onlineManager.setOnlineState(!!state.isConnected);
});
