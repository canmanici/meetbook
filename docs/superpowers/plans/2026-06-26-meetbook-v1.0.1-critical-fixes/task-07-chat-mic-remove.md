# Task 07: Remove non-functional mic button

**Files:**
- Modify: `mobile/src/app/chat/[id].tsx` (mic button at ~line 526-530)
- Test: `mobile/src/app/chat/__tests__/chat-detail.test.tsx` (append)

The mic button shows when the input is empty but has no `onPress` — it advertises voice messages that don't exist. Implementing voice is a separate feature plan. For v1.0.1, **remove the dead button** so the UI doesn't lie. When the input is empty, show nothing (the send button appears once text is typed).

- [ ] **Step 1: Add a failing test that the mic button is gone**

Append to `mobile/src/app/chat/__tests__/chat-detail.test.tsx`:

```typescript
it('does not render a mic button when input is empty', async () => {
  const { queryByTestId, findByTestId } = renderChat();
  // Wait for the chat to render
  await findByTestId('chat-input');
  // No mic button should be present
  expect(queryByTestId('mic-button')).toBeNull();
});

it('shows send button when input has text', async () => {
  const { findByTestId } = renderChat();
  const input = await findByTestId('chat-input');
  fireEvent.changeText(input, 'hello');
  expect(await findByTestId('send-button')).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- chat-detail.test.tsx`
Expected: FAIL — `chat-input` testID may not exist yet, and mic button has no testID.

- [ ] **Step 3: Add testIDs + remove the mic button**

In `mobile/src/app/chat/[id].tsx`:

First, find the input bar `TextInput` (around line ~500-507) and add `testID="chat-input"`:

```tsx
          <TextInput
            testID="chat-input"
            style={[styles.input, { color: colors.text }]}
            // ...existing props...
          />
```

Find the send button `TouchableOpacity` (the one with `onPress={handleSend}`) and add `testID="send-button"`.

Then find the Send/Voice block (~line 510-530). It currently reads:

```tsx
        {inputText.trim() ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSend}
            disabled={!chatId || isSending}
          >
            <LinearGradient
              colors={[colors.primary, isDark ? '#2EA88A' : '#0D5E4F']}
              style={styles.sendBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="send" size={18} color="#ffffff" />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.inputAction, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="mic" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}
```

Replace with (mic button removed, send button gets the testID):

```tsx
        {inputText.trim() ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSend}
            disabled={!chatId || isSending}
            testID="send-button"
          >
            <LinearGradient
              colors={[colors.primary, isDark ? '#2EA88A' : '#0D5E4F']}
              style={styles.sendBtnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="send" size={18} color="#ffffff" />
            </LinearGradient>
          </TouchableOpacity>
        ) : null}
```

The `else` branch (mic button) is replaced with `null` — nothing renders when input is empty. This is the honest v1.0.1 behavior.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- chat-detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/chat/[id].tsx mobile/src/app/chat/__tests__/chat-detail.test.tsx
git commit -m "fix(chat): remove non-functional mic button that advertised voice messages"
```
