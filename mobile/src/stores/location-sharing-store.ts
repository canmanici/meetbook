/**
 * Single source of truth for "Nerdeyim Modu" (live location sharing).
 *
 * v2 design: the SERVER is authoritative. The Redis loc: keys (exposed via
 * GET /exchanges/{id}/location/status) say who is actually sharing — the UI
 * renders from that, refreshed by polling and nudged in real time by
 * location_update / location_stopped WebSocket pushes.
 *
 * Why not device-local state? The previous versions derived "am I sharing"
 * from the local GPS subscription object. One transient GPS failure at
 * start (very common on emulators and indoors) left that object null, so
 * every screen flipped back to "not sharing" on each focus, resurrecting
 * "Sen de Paylaş" banners forever while the partner saw nothing. Server
 * state can't drift like that: if my key exists, I'm sharing; if it
 * doesn't, I'm genuinely not — and the UI says so honestly.
 */
import { create } from 'zustand';

import { chatWS } from '@/lib/api/chat';
import {
  getLocationStatus,
  type PartnerLocation,
  type LocationPrecision,
} from '@/lib/api/client';
import {
  startSafetyMode,
  stopSafetyMode,
  getActiveSharingExchangeId,
  hasSentAnyLocationFix,
} from '@/lib/safety';

export interface ExchangeSharingStatus {
  meSharing: boolean;
  partnerSharing: boolean;
  partnerLocation: PartnerLocation | null;
}

interface LocationSharingState {
  /** Server-reported status per exchange. */
  statusByExchange: Record<string, ExchangeSharingStatus>;
  /** Exchange this device has an active local send-session for. */
  localSessionExchangeId: string | null;
  wsSubscribed: boolean;

  ensureWsSubscribed: () => void;
  /** Re-read local session state (cheap; call on focus). */
  syncLocalSession: () => void;
  /** Fetch authoritative status from the server. */
  refreshStatus: (exchangeId: string) => Promise<void>;
  start: (exchangeId: string, meetupTime: Date, precision?: LocationPrecision) => Promise<void>;
  stop: (exchangeId: string) => void;
  hasSentAnyFix: () => boolean;
}

const EMPTY_STATUS: ExchangeSharingStatus = {
  meSharing: false,
  partnerSharing: false,
  partnerLocation: null,
};

export const useLocationSharingStore = create<LocationSharingState>((set, get) => ({
  statusByExchange: {},
  localSessionExchangeId: null,
  wsSubscribed: false,

  ensureWsSubscribed: () => {
    if (get().wsSubscribed) return;
    console.log('[nerdeyim] WS watcher subscribed');
    chatWS.subscribe((msg) => {
      const exchangeId = msg.exchange_id;
      if (!exchangeId) return;
      if (msg.type === 'location_update' || msg.type === 'location_stopped') {
        console.log(`[nerdeyim] WS ${msg.type} for ${exchangeId.slice(-6)}`, msg.latitude, msg.longitude);
      }
      if (msg.type === 'location_update' && msg.latitude != null && msg.longitude != null) {
        set((state) => {
          const prev = state.statusByExchange[exchangeId] ?? EMPTY_STATUS;
          return {
            statusByExchange: {
              ...state.statusByExchange,
              [exchangeId]: {
                ...prev,
                partnerSharing: true,
                partnerLocation: {
                  latitude: msg.latitude!,
                  longitude: msg.longitude!,
                  updated_at: msg.updated_at ?? new Date().toISOString(),
                  precision: msg.precision,
                },
              },
            },
          };
        });
      } else if (msg.type === 'location_stopped') {
        set((state) => {
          const prev = state.statusByExchange[exchangeId] ?? EMPTY_STATUS;
          return {
            statusByExchange: {
              ...state.statusByExchange,
              [exchangeId]: { ...prev, partnerSharing: false, partnerLocation: null },
            },
          };
        });
      }
    });
    set({ wsSubscribed: true });
  },

  syncLocalSession: () => {
    set({ localSessionExchangeId: getActiveSharingExchangeId() });
  },

  refreshStatus: async (exchangeId) => {
    try {
      const status = await getLocationStatus(exchangeId);
      console.log(
        `[nerdeyim] status ${exchangeId.slice(-6)}: me=${status.me_sharing} partner=${status.partner_sharing} loc=${status.partner_location ? 'yes' : 'no'} localSession=${getActiveSharingExchangeId()?.slice(-6) ?? 'none'}`,
      );
      set((state) => ({
        statusByExchange: {
          ...state.statusByExchange,
          [exchangeId]: {
            meSharing: status.me_sharing,
            partnerSharing: status.partner_sharing,
            partnerLocation: status.partner_location,
          },
        },
        // Server truth also corrects the local flag: if the server has no
        // key for me and this device has no session, I'm not sharing —
        // regardless of what any screen believed.
        localSessionExchangeId: getActiveSharingExchangeId(),
      }));
    } catch (err) {
      // transient — next poll or WS push recovers; but never silently:
      // an *always*-failing poll is exactly the kind of thing that made
      // earlier iterations of this feature undiagnosable.
      console.warn(`[nerdeyim] status fetch FAILED for ${exchangeId.slice(-6)}:`, err);
    }
  },

  start: async (exchangeId, meetupTime, precision = 'exact') => {
    console.log(`[nerdeyim] start() for ${exchangeId.slice(-6)}`);
    await startSafetyMode(exchangeId, meetupTime, precision); // throws SafetyPermissionError on denial
    console.log(`[nerdeyim] start() OK — session=${getActiveSharingExchangeId()?.slice(-6)}`);
    set({ localSessionExchangeId: exchangeId });
    // Optimistically flip meSharing; the next refreshStatus confirms it
    // against the server once the first fix lands.
    set((state) => {
      const prev = state.statusByExchange[exchangeId] ?? EMPTY_STATUS;
      return {
        statusByExchange: {
          ...state.statusByExchange,
          [exchangeId]: { ...prev, meSharing: true },
        },
      };
    });
  },

  stop: (exchangeId) => {
    stopSafetyMode();
    set((state) => {
      const prev = state.statusByExchange[exchangeId] ?? EMPTY_STATUS;
      return {
        localSessionExchangeId: null,
        statusByExchange: {
          ...state.statusByExchange,
          [exchangeId]: { ...prev, meSharing: false },
        },
      };
    });
  },

  hasSentAnyFix: () => hasSentAnyLocationFix(),
}));
