const mockWatchers: ((msg: any) => void)[] = [];
const mockSend = jest.fn(() => true);

jest.mock('@/lib/api/chat', () => ({
  chatWS: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: (...args: unknown[]) => (mockSend as any)(...args),
    subscribe: (w: (msg: any) => void) => {
      mockWatchers.push(w);
      return () => {
        const i = mockWatchers.indexOf(w);
        if (i >= 0) mockWatchers.splice(i, 1);
      };
    },
  },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'me' } }) },
}));

import { useChatStore } from '../chat-store';

const emit = (msg: any) => mockWatchers.forEach((w) => w(msg));
const serverMsg = (id: string, text: string) => ({
  id, chat_id: 'c1', sender_id: 'me', text, created_at: '2026-01-01T00:00:00Z',
  message_type: 'text', read_at: null, reply_to_id: null,
});

beforeEach(() => {
  useChatStore.getState().disconnect();
  useChatStore.setState({ messages: {}, error: null, readReceipts: {} });
  mockSend.mockClear();
  mockSend.mockReturnValue(true);
});

it('subscribes to the socket only once across repeated connects', () => {
  const { connect } = useChatStore.getState();
  connect();
  connect();
  connect();
  expect(mockWatchers).toHaveLength(1);
});

it('trims text and reconciles the optimistic bubble by echoed client_id', () => {
  const s = useChatStore.getState();
  s.connect();
  s.sendMessage('c1', '  merhaba  ');
  const [, text, , , , clientId] = mockSend.mock.calls[0] as unknown as unknown[];
  expect(text).toBe('merhaba');
  expect(useChatStore.getState().messages.c1).toHaveLength(1);

  emit({ type: 'message', message: serverMsg('real-1', 'merhaba'), client_id: clientId });
  const list = useChatStore.getState().messages.c1;
  expect(list.map((m) => m.id)).toEqual(['real-1']);
});

it('drops the optimistic bubble and reports an error when the server rejects it', () => {
  const s = useChatStore.getState();
  s.connect();
  s.sendMessage('c1', 'selam');
  const clientId = (mockSend.mock.calls[0] as unknown as unknown[])[5];
  emit({ type: 'error', error: 'blocked', client_id: clientId });
  expect(useChatStore.getState().messages.c1).toEqual([]);
  expect(useChatStore.getState().error).toContain('blocked');
});

it('ignores whitespace-only text messages', () => {
  useChatStore.getState().sendMessage('c1', '   ');
  expect(mockSend).not.toHaveBeenCalled();
});

it('applies live read receipts', () => {
  const s = useChatStore.getState();
  s.connect();
  emit({ type: 'message', message: { ...serverMsg('m1', 'a'), sender_id: 'other' } });
  emit({ type: 'read', message_ids: ['m1'], read_at: '2026-01-01T00:01:00Z' });
  expect(useChatStore.getState().messages.c1[0].read_at).toBe('2026-01-01T00:01:00Z');
  expect(useChatStore.getState().readReceipts.m1).toBe('2026-01-01T00:01:00Z');
});

it('a newer typing event keeps the indicator alive past the older timer', () => {
  jest.useFakeTimers();
  const s = useChatStore.getState();
  s.setTyping('c1', 'u2', true);
  jest.advanceTimersByTime(4000);
  s.setTyping('c1', 'u2', true);
  jest.advanceTimersByTime(2000); // first timer would have fired here
  expect(useChatStore.getState().typing.c1.u2).toBe(true);
  jest.advanceTimersByTime(3500);
  expect(useChatStore.getState().typing.c1.u2).toBe(false);
  jest.useRealTimers();
});
