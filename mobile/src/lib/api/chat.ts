/**
 * Chat API functions + WebSocket connection manager — full-featured.
 */
import { useAuthStore } from '@/stores/auth-store';
import { authedRequest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReactionView {
  emoji: string;
  users: string[];
  count: number;
}

export interface MessageView {
  id: string;
  chat_id: string;
  sender_id: string | null;
  message_type: 'text' | 'image' | 'voice' | 'location' | 'location_invite' | 'book_card' | 'system';
  text: string;
  created_at: string;
  read_at: string | null;
  reply_to_id?: string | null;
  reply_to_text?: string | null;
  reply_to_sender_name?: string | null;
  reactions?: ReactionView[];
  starred_at?: string | null;
  pinned_at?: string | null;
  extra?: {
    // image
    url?: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
    // voice
    duration_seconds?: number;
    // location
    lat?: number;
    lng?: number;
    name?: string;
    // location_invite
    exchange_id?: string;
    // book_card
    book_id?: string;
    title?: string;
    author?: string;
    cover_url?: string;
    category?: string;
    // system
    action?: string;
    data?: Record<string, unknown>;
  } | null;
}

export interface MessageListResponse {
  items: MessageView[];
  next_cursor: string | null;
}

export interface MessageSearchResult {
  message: MessageView;
  context_before: string | null;
  context_after: string | null;
}

export interface MessageSearchResponse {
  items: MessageSearchResult[];
  total: number;
}

export interface ChatSettingsView {
  is_muted: boolean;
  wallpaper_url: string | null;
  font_size: string;
  notification_sound: string;
}

export interface ChatSettingsResponse {
  settings: ChatSettingsView;
}

export interface ChatSummary {
  chat_id: string;
  exchange_id: string;
  counterpart_id: string;
  counterpart_name: string;
  counterpart_avatar_url?: string | null;
  last_message: string | null;
  last_message_type: string;
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

export interface MessageDeliveryInfo {
  message_id: string;
  sent_at: string;
  read_at: string | null;
  delivered_to: string;
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export async function getChatTicket(): Promise<ChatTicketResponse> {
  return authedRequest<ChatTicketResponse>('/chat/ticket', 'POST', undefined);
}

export interface IceServerConfig {
  urls: string[];
  username?: string | null;
  credential?: string | null;
}

export interface TurnCredentialsResponse {
  ice_servers: IceServerConfig[];
  ttl_seconds: number;
}

/** Ephemeral TURN credentials — minted per call, self-expire server-side. */
export async function getTurnCredentials(): Promise<TurnCredentialsResponse> {
  return authedRequest<TurnCredentialsResponse>('/chat/turn-credentials', 'GET', undefined);
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
  if (cursor) params.cursor = cursor;
  return authedRequest<MessageListResponse>(
    `/exchanges/${exchangeId}/chat/messages`,
    'GET',
    undefined,
    { query: params },
  );
}

export async function searchMessages(
  exchangeId: string,
  query: string,
  limit = 50,
): Promise<MessageSearchResponse> {
  return authedRequest<MessageSearchResponse>(
    `/exchanges/${exchangeId}/chat/messages/search`,
    'GET',
    undefined,
    { query: { q: query, limit } },
  );
}

export async function getPinnedMessages(exchangeId: string): Promise<{ items: MessageView[] }> {
  return authedRequest(`/exchanges/${exchangeId}/chat/messages/pinned`, 'GET', undefined);
}

export async function toggleStarMessage(exchangeId: string, messageId: string): Promise<{ starred: boolean }> {
  return authedRequest(`/exchanges/${exchangeId}/chat/messages/${messageId}/star`, 'POST', undefined);
}

export async function togglePinMessage(exchangeId: string, messageId: string): Promise<{ pinned: boolean }> {
  return authedRequest(`/exchanges/${exchangeId}/chat/messages/${messageId}/pin`, 'POST', undefined);
}

export async function getMessageInfo(exchangeId: string, messageId: string): Promise<MessageDeliveryInfo> {
  return authedRequest(`/exchanges/${exchangeId}/chat/messages/${messageId}/info`, 'GET', undefined);
}

export async function markMessagesRead(exchangeId: string, upToMessageId: string): Promise<void> {
  return authedRequest(`/exchanges/${exchangeId}/chat/read`, 'POST', { up_to_message_id: upToMessageId });
}

export async function getChatSettings(exchangeId: string): Promise<ChatSettingsResponse> {
  return authedRequest(`/exchanges/${exchangeId}/chat/settings`, 'GET', undefined);
}

export async function updateChatSettings(
  exchangeId: string,
  settings: Partial<{ is_muted: boolean; wallpaper_url: string; font_size: string; notification_sound: string }>,
): Promise<ChatSettingsResponse> {
  return authedRequest(`/exchanges/${exchangeId}/chat/settings`, 'PATCH', settings);
}

export async function getStarredMessages(): Promise<{ items: MessageView[] }> {
  return authedRequest('/chat/starred', 'GET', undefined);
}

export async function uploadChatMedia(
  exchangeId: string,
  file: FormData,
): Promise<{ url: string; thumbnail_url?: string }> {
  return authedRequest(`/exchanges/${exchangeId}/chat/media`, 'POST', file);
}

// ---------------------------------------------------------------------------
// WebSocket connection manager
// ---------------------------------------------------------------------------

export type WSWatcher = (msg: WSMessage) => void;

export type CallEvent =
  | 'offer' | 'answer' | 'ice' | 'end' | 'reject' | 'cancel' | 'busy' | 'unavailable';

export interface WSMessage {
  type:
    | 'message' | 'read' | 'typing' | 'reaction' | 'deleted' | 'presence' | 'error' | 'pong'
    | 'location_update' | 'location_stopped' | 'call' | 'cleared'
    | 'club_message' | 'club_deleted' | 'club_updated';
  // book clubs (message is a ClubMessage for club_message)
  club_id?: string;
  // call signaling
  event?: CallEvent;
  call_id?: string;
  kind?: 'audio' | 'video';
  sender_name?: string;
  payload?: unknown;
  message?: MessageView & { club_id?: string; sender_name?: string | null; sender_avatar_url?: string | null };
  error?: string;
  chat_id?: string;
  message_id?: string;
  read_by?: string;
  up_to_message_id?: string;
  user_id?: string;
  is_typing?: boolean;
  is_online?: boolean;
  reactions?: Array<{ emoji: string; users: string[]; count: number }>;
  sender_id?: string;
  // location_update / location_stopped
  exchange_id?: string;
  latitude?: number;
  longitude?: number;
  precision?: 'exact' | 'approximate';
  updated_at?: string;
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
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  subscribe(watcher: WSWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private notify(msg: WSMessage) {
    for (const w of this.watchers) {
      try { w(msg); } catch {}
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
        this.pingInterval = setInterval(() => this.ping(), 30000);
        // Request presence on connect
        this.ws?.send(JSON.stringify({ type: 'presence' }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          this.notify(data);
        } catch {}
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.ws = null;
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = () => { this.isConnecting = false; };
    } catch {
      this.isConnecting = false;
      this.reconnectTimer = setTimeout(() => this.connect(), 10000);
    }
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
  }

  send(chatId: string, text: string, replyToId?: string | null, messageType = 'text', extra?: Record<string, unknown> | null): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload: Record<string, unknown> = { type: 'send', chat_id: chatId, text, message_type: messageType };
      if (replyToId) payload.reply_to_id = replyToId;
      if (extra) payload.extra = extra;
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  sendTyping(chatId: string, isTyping: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', chat_id: chatId, is_typing: isTyping }));
    }
  }

  deleteMessage(chatId: string, messageId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete', chat_id: chatId, message_id: messageId }));
    }
  }

  sendReaction(chatId: string, messageId: string, emoji: string, action: 'add' | 'remove') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reaction', chat_id: chatId, message_id: messageId, emoji, action }));
    }
  }

  /** WebRTC call signaling — relayed verbatim to the chat counterpart. */
  sendCall(
    chatId: string,
    event: CallEvent,
    callId: string,
    kind: 'audio' | 'video',
    payload?: unknown,
    log?: { status: 'ended' | 'missed' | 'rejected' | 'failed'; duration_seconds: number; route?: 'direct' | 'relay' | null },
  ): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg: Record<string, unknown> = { type: 'call', chat_id: chatId, event, call_id: callId, kind };
      if (payload !== undefined) msg.payload = payload;
      if (log) msg.log = log;
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** Resolves once the socket reaches OPEN, or false if it doesn't within timeoutMs.
   *  Kicks a reconnect attempt immediately instead of waiting for the backoff timer. */
  private waitForOpen(timeoutMs: number): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(true);
    void this.connect();
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          clearInterval(poll);
          resolve(true);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(poll);
          resolve(false);
        }
      }, 150);
    });
  }

  /** Like sendCall, but tolerates a socket that's mid-reconnect (screen lock,
   *  network blip) by waiting up to timeoutMs for it to come back before
   *  giving up. Use for the offer/answer handshake, where a silently dropped
   *  message strands the other side with no recovery path. */
  async sendCallReliable(
    chatId: string,
    event: CallEvent,
    callId: string,
    kind: 'audio' | 'video',
    payload?: unknown,
    log?: { status: 'ended' | 'missed' | 'rejected' | 'failed'; duration_seconds: number; route?: 'direct' | 'relay' | null },
    timeoutMs = 4000,
  ): Promise<boolean> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      const opened = await this.waitForOpen(timeoutMs);
      if (!opened) return false;
    }
    return this.sendCall(chatId, event, callId, kind, payload, log);
  }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
}

export const chatWS = new ChatWebSocketManager();
