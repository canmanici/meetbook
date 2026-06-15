/**
 * Zustand store for chat state — manages WebSocket lifecycle, unread counts,
 * and provides real-time message subscription to screens.
 */
import { create } from 'zustand';

import type { MessageView } from '@/lib/api/chat';
import { chatWS } from '@/lib/api/chat';

interface ChatState {
  /** Whether the WebSocket is connected (or attempting to connect). */
  connected: boolean;
  /** In-memory buffer of recent messages per chat (chat_id → MessageView[]). */
  messages: Record<string, MessageView[]>;
  /** Optimistic message IDs being sent (client-generated, not yet confirmed). */
  pendingIds: Set<string>;

  // Actions
  connect: () => void;
  disconnect: () => void;
  sendMessage: (chatId: string, text: string) => void;
  addMessage: (chatId: string, msg: MessageView) => void;
  setConnected: (connected: boolean) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  connected: false,
  messages: {},
  pendingIds: new Set(),

  connect: () => {
    chatWS.connect();
    // The watcher receives real-time messages
    chatWS.subscribe((msg) => {
      if (msg.type === 'message' && msg.message) {
        get().addMessage(msg.message.chat_id, msg.message);
      }
    });
    set({ connected: true });
  },

  disconnect: () => {
    chatWS.disconnect();
    set({ connected: false });
  },

  sendMessage: (chatId, text) => {
    chatWS.send(chatId, text);
  },

  addMessage: (chatId, msg) => {
    set((state) => {
      const existing = state.messages[chatId] ?? [];
      // Avoid duplicates
      if (existing.some((m) => m.id === msg.id)) return state;
      return {
        messages: {
          ...state.messages,
          [chatId]: [...existing, msg],
        },
      };
    });
  },

  setConnected: (connected) => set({ connected }),
}));
