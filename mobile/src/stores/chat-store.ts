/**
 * Zustand store for chat state — full-featured: messages, typing, reactions,
 * presence, replies, starred, pinned.
 */
import { create } from 'zustand';

import { useAuthStore } from '@/stores/auth-store';
import type { MessageView, ReactionView } from '@/lib/api/chat';
import { chatWS } from '@/lib/api/chat';

interface TypingState {
  [chatId: string]: { [userId: string]: boolean };
}

interface PresenceState {
  [userId: string]: { is_online: boolean; last_seen: string | null };
}

interface ChatState {
  connected: boolean;
  messages: Record<string, MessageView[]>;
  pendingIds: Set<string>;
  typing: TypingState;
  presence: PresenceState;
  replyingTo: MessageView | null;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  sendMessage: (chatId: string, text: string, replyToId?: string | null, messageType?: string, extra?: Record<string, unknown> | null) => void;
  addMessage: (chatId: string, msg: MessageView) => void;
  deleteMessage: (chatId: string, messageId: string) => void;
  updateReactions: (chatId: string, messageId: string, reactions: ReactionView[]) => void;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, isOnline: boolean, lastSeen?: string | null) => void;
  setReplyingTo: (msg: MessageView | null) => void;
  setConnected: (connected: boolean) => void;
  sendTyping: (chatId: string, isTyping: boolean) => void;
  sendDelete: (chatId: string, messageId: string) => void;
  sendReaction: (chatId: string, messageId: string, emoji: string, action: 'add' | 'remove') => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  connected: false,
  messages: {},
  pendingIds: new Set(),
  typing: {},
  presence: {},
  replyingTo: null,
  error: null,

  connect: () => {
    chatWS.connect();
    chatWS.subscribe((msg) => {
      if (msg.type === 'message' && msg.message) {
        get().addMessage(msg.message.chat_id, msg.message);
      } else if (msg.type === 'typing' && msg.chat_id && msg.user_id) {
        get().setTyping(msg.chat_id, msg.user_id, msg.is_typing ?? false);
      } else if (msg.type === 'deleted' && msg.chat_id && msg.message_id) {
        get().deleteMessage(msg.chat_id, msg.message_id);
      } else if (msg.type === 'reaction' && msg.chat_id && msg.message_id && msg.reactions) {
        get().updateReactions(msg.chat_id, msg.message_id, msg.reactions);
      } else if (msg.type === 'presence' && msg.user_id) {
        get().setPresence(msg.user_id, msg.is_online ?? false);
      }
    });
    set({ connected: true });
  },

  disconnect: () => {
    chatWS.disconnect();
    set({ connected: false, typing: {}, presence: {} });
  },

  sendMessage: (chatId, text, replyToId, messageType = 'text', extra = null) => {
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: MessageView = {
      id: tempId,
      chat_id: chatId,
      sender_id: useAuthStore.getState().user?.id ?? 'pending',
      text,
      created_at: new Date().toISOString(),
      message_type: (messageType as MessageView['message_type']) ?? 'text',
      read_at: null,
      reply_to_id: replyToId ?? null,
    };
    if (extra) optimisticMsg.extra = extra as MessageView['extra'];

    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), optimisticMsg],
      },
      error: null,
    }));

    const sent = chatWS.send(chatId, text, replyToId, messageType, extra);
    if (!sent) {
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).filter((m) => m.id !== tempId),
        },
        error: 'Bağlantı yok. Mesaj gönderilemedi.',
      }));
    }
  },

  addMessage: (chatId, msg) => {
    set((state) => {
      const existing = state.messages[chatId] ?? [];
      if (existing.some((m) => m.id === msg.id)) return state;
      const withoutTemp = existing.filter((m) => !m.id.startsWith('temp-'));
      return {
        messages: {
          ...state.messages,
          [chatId]: [...withoutTemp, msg],
        },
      };
    });
  },

  deleteMessage: (chatId, messageId) => {
    set((state) => {
      const existing = state.messages[chatId] ?? [];
      return {
        messages: {
          ...state.messages,
          [chatId]: existing.map((m) =>
            m.id === messageId ? { ...m, text: '', deleted_at: new Date().toISOString() } : m
          ),
        },
      };
    });
  },

  updateReactions: (chatId, messageId, reactions) => {
    set((state) => {
      const existing = state.messages[chatId] ?? [];
      return {
        messages: {
          ...state.messages,
          [chatId]: existing.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
        },
      };
    });
  },

  setTyping: (chatId, userId, isTyping) => {
    set((state) => {
      const chatTyping = state.typing[chatId] ?? {};
      return {
        typing: {
          ...state.typing,
          [chatId]: { ...chatTyping, [userId]: isTyping },
        },
      };
    });
    if (isTyping) {
      setTimeout(() => get().setTyping(chatId, userId, false), 5000);
    }
  },

  setPresence: (userId, isOnline, lastSeen = null) => {
    set((state) => ({
      presence: {
        ...state.presence,
        [userId]: {
          is_online: isOnline,
          last_seen: lastSeen ?? state.presence[userId]?.last_seen ?? null,
        },
      },
    }));
  },

  setReplyingTo: (msg) => set({ replyingTo: msg }),
  setConnected: (connected) => set({ connected }),
  sendTyping: (chatId, isTyping) => chatWS.sendTyping(chatId, isTyping),
  sendDelete: (chatId, messageId) => chatWS.deleteMessage(chatId, messageId),
  sendReaction: (chatId, messageId, emoji, action) => chatWS.sendReaction(chatId, messageId, emoji, action),
}));
