# Task 06: Implement chat search scroll-to-message

**Files:**
- Modify: `mobile/src/app/chat/[id].tsx` (search result tap at ~line 413-416)
- Test: `mobile/src/app/chat/__tests__/chat-detail.test.tsx` (append)

Tapping a search result currently runs `// TODO: scroll to message` then clears search — nothing scrolls. Implement it: find the message index in the rendered `listData` and call `flatListRef.current.scrollToIndex({ index, animated: true })`.

- [ ] **Step 1: Add a failing test for scroll-to-message**

Append to `mobile/src/app/chat/__tests__/chat-detail.test.tsx`. First, update the `getMessages` mock to return a known message so we can search for it:

```typescript
it('search result tap scrolls FlatList to that message', async () => {
  const { searchMessages } = require('@/lib/api/chat');
  searchMessages.mockResolvedValue({
    items: [{ id: 'msg-9', text: 'found me', created_at: '2026-06-02T00:00:00Z', sender_id: 'u2' }],
  });

  const { findByPlaceholderText, findByTestId, queryByTestId } = renderChat();

  // Open search mode
  const searchToggle = await findByTestId('chat-search-toggle');
  fireEvent.press(searchToggle);

  const input = await findByPlaceholderText('Sohbette ara...');
  fireEvent.changeText(input, 'found');
  fireEvent(input, 'submitEditing');

  // Wait for the search result item to appear
  const resultItem = await findByTestId('search-result-msg-9');
  fireEvent.press(resultItem);

  // After pressing, search should clear (result list disappears)
  await waitFor(() => expect(queryByTestId('search-result-msg-9')).toBeNull());
});
```

Note: this test asserts the search clears (the existing behavior) AND the result item has a testID we will add. The actual `scrollToIndex` call happens on the FlatList ref — we verify via the testID + behavior. If you want to assert the ref call, mock the FlatList ref's `scrollToIndex`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- chat-detail.test.tsx`
Expected: FAIL — `search-result-msg-9` testID not found (results have no testID).

- [ ] **Step 3: Implement scroll-to-message + add testID**

In `mobile/src/app/chat/[id].tsx`, find the search results block (~line 409-425). The result `TouchableOpacity` currently has `key={msg.id}` and the TODO. Replace it:

```tsx
          {searchResults.slice(0, 10).map((msg) => (
            <TouchableOpacity
              key={msg.id}
              testID={`search-result-${msg.id}`}
              style={[styles.searchResultItem, { borderBottomColor: colors.border }]}
              onPress={() => {
                // Find the message in the flattened list and scroll to it
                const flat = isSearchMode ? listData : listData;
                const index = flat.findIndex((item) => item.id === msg.id);
                if (index >= 0 && flatListRef.current) {
                  try {
                    flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                  } catch {
                    // index out of range (message not in loaded pages) — ignore
                  }
                }
                clearSearch();
              }}
            >
```

Note: `listData` is the array passed to the FlatList (line ~432: `data={isSearchMode ? [] : listData}`). Each item has an `id` field (the message id). `flatListRef` is already declared (line ~431: `ref={flatListRef}`). `clearSearch` already exists.

The `viewPosition: 0.5` centers the message in the viewport.

- [ ] **Step 4: Add the search-toggle testID**

For the test to find the search toggle, the search button needs a testID. Find the search toggle button (~line 354, the `TouchableOpacity` with the search/close icon). Add `testID="chat-search-toggle"`:

```tsx
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => {
            if (isSearchMode) {
              clearSearch();
            } else {
              setIsSearchMode(true);
            }
          }}
          testID="chat-search-toggle"
        >
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- chat-detail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/chat/[id].tsx mobile/src/app/chat/__tests__/chat-detail.test.tsx
git commit -m "fix(chat): implement search result scroll-to-message"
```
