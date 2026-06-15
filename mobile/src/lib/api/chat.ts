/**
 * Chat API functions + WebSocket connection manager.
 */
import { useAuthStore } from '@/stores/auth-store';
import { authedRequest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageView {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  read_at: string | null;
}

export interface MessageListResponse {
  items: MessageView[];
  next_cursor: string | null;
}

export interface ChatSummary {
  chat_id: string;
  exchange_id: string;
  counterpart_id: string;
  counterpart_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface ChatListResponse {
  items: ChatSummary[];
}

export interface ChatTicketResponse {
  ticket: string;
  expires_in_seconds: number;
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export async function getChatTicket(): Promise<ChatTicketResponse> {
  return authedRequest<ChatTicketResponse>('/chat/ticket', 'POST', undefined);
}

export async function listChats(): Promise<ChatListResponse> {
  return authedRequest<ChatListResponse>('/chat', 'GET', undefined);
}

export async function getMessages(
  exchangeId: string,
  cursor?: string | null,
  limit = 50,
): Promise<MessageListResponse> {
  const params: Record<string, string | number> = { limit };
  if (cursor) {
    params.cursor = cursor;
  }
  return authedRequest<MessageListResponse>(
    `/exchanges/${exchangeId}/chat/messages`,
    'GET',
    undefined,
    { query: params },
  );
}

export async function markMessagesRead(
  exchangeId: string,
  upToMessageId: string,
): Promise<void> {
  return authedRequest<void>(
    `/exchanges/${exchangeId}/chat/read`,
    'POST',
    { up_to_message_id: upToMessageId },
  );
}

// ---------------------------------------------------------------------------
// WebSocket connection manager
// ---------------------------------------------------------------------------

export type WSWatcher = (msg: WSMessage) => void;

export interface WSMessage {
  type: 'message' | 'read' | 'error' | 'pong';
  message?: MessageView;
  error?: string;
  chat_id?: string;
  read_by?: string;
  up_to_message_id?: string;
}

const WS_BASE =
  process.env.EXPO_PUBLIC_WS_URL ??
  process.env.EXPO_PUBLIC_API_URL?.replace(/^http/, 'ws')?.replace(/\/api\/v1$/, '') ??
  'ws://localhost:8000';

class ChatWebSocketManager {
  private ws: WebSocket | null = null;
  private watchers: Set<WSWatcher> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  subscribe(watcher: WSWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private notify(msg: WSMessage) {
    for (const w of this.watchers) {
      try {
        w(msg);
      } catch {
        /* ignore per-watcher errors */
      }
    }
  }

  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;
    this.isConnecting = true;

    try {
      const { ticket } = await getChatTicket();
      const url = `${WS_BASE}/ws/chat?ticket=${ticket}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnecting = false;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          this.notify(data);
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.ws = null;
        // Reconnect after 5 seconds
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch {
      this.isConnecting = false;
      // Retry connection later
      this.reconnectTimer = setTimeout(() => this.connect(), 10000);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  send(chatId: string, text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'send', chat_id: chatId, text }));
    }
  }
}

export const chatWS = new ChatWebSocketManager();
