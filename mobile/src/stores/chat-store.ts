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
  /** messageId → read_at, from live 'read' events (overlays fetched pages). */
  readReceipts: Record<string, string>;
  replyingTo: MessageView | null;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  sendMessage: (chatId: string, text: string, replyToId?: string | null, messageType?: string, extra?: Record<string, unknown> | null) => void;
  addMessage: (chatId: string, msg: MessageView, clientId?: string) => void;
  failMessage: (clientId: string, error: string) => void;
  markRead: (messageIds: string[], readAt: string) => void;
  deleteMessage: (chatId: string, messageId: string) => void;
  updateReactions: (chatId: string, messageId: string, reactions: ReactionView[]) => void;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, isOnline: boolean, lastSeen?: string | null) => void;
  setReplyingTo: (msg: MessageView | null) => void;
  setConnected: (connected: boolean) => void;
  clearError: () => void;
  sendTyping: (chatId: string, isTyping: boolean) => void;
  sendDelete: (chatId: string, messageId: string) => void;
  sendReaction: (chatId: string, messageId: string, emoji: string, action: 'add' | 'remove') => void;
}

// Single app-lifetime WS subscription (see connect()).
let unsubscribeWS: (() => void) | null = null;
// Per (chat,user) auto-clear timers for the typing indicator.
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let tempSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  connected: false,
  messages: {},
  pendingIds: new Set(),
  typing: {},
  presence: {},
  readReceipts: {},
  replyingTo: null,
  error: null,

  connect: () => {
    // The socket is app-global (CallManager keeps it open while signed in —
    // it also carries call signaling), so screens only ever ensure it's open.
    chatWS.connect();
    // Subscribe exactly once for the app's lifetime; re-subscribing on every
    // focus leaked a watcher per visit and multiplied every WS event.
    if (unsubscribeWS) return;
    unsubscribeWS = chatWS.subscribe((msg) => {
      if (msg.type === 'message' && msg.message) {
        get().addMessage(msg.message.chat_id, msg.message, msg.client_id);
      } else if (msg.type === 'error' && msg.client_id) {
        get().failMessage(msg.client_id, msg.error ?? 'Mesaj gönderilemedi.');
      } else if (msg.type === 'read' && msg.message_ids && msg.read_at) {
        get().markRead(msg.message_ids, msg.read_at);
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

  /** Full teardown — logout only. Never call on screen blur: closing the
   *  socket there silently killed incoming calls on every other tab. */
  disconnect: () => {
    unsubscribeWS?.();
    unsubscribeWS = null;
    chatWS.disconnect();
    set({ connected: false, typing: {}, presence: {}, readReceipts: {} });
  },

  sendMessage: (chatId, rawText, replyToId, messageType = 'text', extra = null) => {
    // The backend strips whitespace; do the same so the optimistic bubble
    // shows exactly what gets stored.
    const text = rawText.trim();
    if (!text && messageType === 'text') return;
    tempSeq += 1;
    const tempId = `temp-${Date.now()}-${tempSeq}`;
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

    const sent = chatWS.send(chatId, text, replyToId, messageType, extra, tempId);
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

  addMessage: (chatId, msg, clientId) => {
    set((state) => {
      const existing = state.messages[chatId] ?? [];
      if (existing.some((m) => m.id === msg.id)) return state;
      let withoutTemp = existing;
      if (clientId && existing.some((m) => m.id === clientId)) {
        // Exact reconciliation via the echoed client id.
        withoutTemp = existing.filter((m) => m.id !== clientId);
      } else {
        // Fallback (echo without client_id): reconcile ONE optimistic
        // message by sender+text+type. Never drop all temps — that ate
        // rapid-fire messages.
        const myId = useAuthStore.getState().user?.id;
        let reconciled = false;
        withoutTemp =
          msg.sender_id === myId
            ? existing.filter((m) => {
                if (reconciled || !m.id.startsWith('temp-')) return true;
                if (m.text === msg.text && m.message_type === msg.message_type) {
                  reconciled = true;
                  return false;
                }
                return true;
              })
            : existing;
      }
      return {
        messages: {
          ...state.messages,
          [chatId]: [...withoutTemp, msg],
        },
      };
    });
  },

  failMessage: (clientId, error) => {
    // The server rejected an optimistic send (blocked, too long, …): drop the
    // bubble instead of leaving it looking "sent" forever, and surface why.
    set((state) => {
      const messages: Record<string, MessageView[]> = {};
      for (const [cid, list] of Object.entries(state.messages)) {
        messages[cid] = list.some((m) => m.id === clientId) ? list.filter((m) => m.id !== clientId) : list;
      }
      return { messages, error: `Mesaj gönderilemedi: ${error}` };
    });
  },

  markRead: (messageIds, readAt) => {
    set((state) => {
      const readReceipts = { ...state.readReceipts };
      for (const id of messageIds) readReceipts[id] = readAt;
      const ids = new Set(messageIds);
      const messages: Record<string, MessageView[]> = {};
      for (const [cid, list] of Object.entries(state.messages)) {
        messages[cid] = list.some((m) => ids.has(m.id))
          ? list.map((m) => (ids.has(m.id) && !m.read_at ? { ...m, read_at: readAt } : m))
          : list;
      }
      return { readReceipts, messages };
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
    // One timer per (chat,user): a fresh "typing" restarts it, so an older
    // timer can no longer switch off a newer indicator (flicker).
    const key = `${chatId}:${userId}`;
    const prev = typingTimers.get(key);
    if (prev) clearTimeout(prev);
    typingTimers.delete(key);
    if (isTyping) {
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          get().setTyping(chatId, userId, false);
        }, 5000),
      );
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
  clearError: () => set({ error: null }),
  sendTyping: (chatId, isTyping) => chatWS.sendTyping(chatId, isTyping),
  sendDelete: (chatId, messageId) => chatWS.deleteMessage(chatId, messageId),
  sendReaction: (chatId, messageId, emoji, action) => chatWS.sendReaction(chatId, messageId, emoji, action),
}));
