/**
 * "Nerdeyim Modu" (live location sharing) as a single hook consumed by both
 * chat/[id].tsx and exchange/[id].tsx.
 *
 * All state comes from the shared store, whose truth is the SERVER's
 * /location/status endpoint (polled) + WebSocket pushes (real-time).
 * See stores/location-sharing-store.ts for the design rationale.
 */
import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';

import type { LocationPrecision } from '@/lib/api/client';
import { useLocationSharingStore } from '@/stores/location-sharing-store';

const STATUS_POLL_MS = 15_000;

export function useNerdeyimMode(exchangeId: string | undefined, enabled: boolean) {
  const {
    status,
    localSessionExchangeId,
    ensureWsSubscribed,
    syncLocalSession,
    refreshStatus,
    start: storeStart,
    stop: storeStop,
  } = useLocationSharingStore(
    useShallow((s) => ({
      status: exchangeId ? s.statusByExchange[exchangeId] : undefined,
      localSessionExchangeId: s.localSessionExchangeId,
      ensureWsSubscribed: s.ensureWsSubscribed,
      syncLocalSession: s.syncLocalSession,
      refreshStatus: s.refreshStatus,
      start: s.start,
      stop: s.stop,
    })),
  );

  // On focus: re-read the local session and pull fresh server truth once.
  useFocusEffect(
    useCallback(() => {
      syncLocalSession();
      if (enabled && exchangeId) refreshStatus(exchangeId);
    }, [syncLocalSession, refreshStatus, enabled, exchangeId]),
  );

  // While mounted with a confirmed meetup: subscribe to WS pushes and poll
  // the status endpoint as the drift-proof fallback.
  useEffect(() => {
    if (!enabled || !exchangeId) return;
    ensureWsSubscribed();
    refreshStatus(exchangeId);
    const interval = setInterval(() => refreshStatus(exchangeId), STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, exchangeId, ensureWsSubscribed, refreshStatus]);

  // "Am I sharing" = server says so, OR this device has a live session
  // (covers the first seconds before the initial fix reaches Redis).
  const isSharing =
    !!exchangeId && (status?.meSharing === true || localSessionExchangeId === exchangeId);
  const partnerSharing = status?.partnerSharing ?? false;
  const partnerLocation = status?.partnerLocation ?? null;

  useEffect(() => {
    if (!enabled || !exchangeId) return;
    console.log(
      `[nerdeyim] derived ${exchangeId.slice(-6)}: isSharing=${isSharing} partnerSharing=${partnerSharing} pin=${partnerLocation ? 'yes' : 'no'}`,
    );
  }, [enabled, exchangeId, isSharing, partnerSharing, partnerLocation]);

  const start = useCallback(
    async (meetupTime: Date, precision?: LocationPrecision) => {
      if (!exchangeId) throw new Error('NO_EXCHANGE');
      await storeStart(exchangeId, meetupTime, precision);
      // Confirm against the server shortly after the initial fix should land.
      setTimeout(() => refreshStatus(exchangeId), 4000);
    },
    [exchangeId, storeStart, refreshStatus],
  );

  const stop = useCallback(() => {
    if (exchangeId) storeStop(exchangeId);
  }, [exchangeId, storeStop]);

  return { isSharing, partnerSharing, partnerLocation, start, stop };
}
