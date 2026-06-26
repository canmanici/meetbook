# Task 13: Add KeyboardAvoidingView to auth forms

**Files:**
- Modify: `mobile/src/app/auth/login.tsx`
- Modify: `mobile/src/app/auth/register.tsx`
- Test: `mobile/src/app/auth/__tests__/login.test.tsx` (append)
- Test: `mobile/src/app/auth/__tests__/register.test.tsx` (append)

Only `chat/[id].tsx` uses `KeyboardAvoidingView`. Login and register users fight the keyboard when typing email/password. Wrap both form screens in `KeyboardAvoidingView` so inputs stay visible above the keyboard.

- [ ] **Step 1: Add a failing test for login keyboard handling**

Append to `mobile/src/app/auth/__tests__/login.test.tsx`:

```typescript
it('wraps the form in a KeyboardAvoidingView', () => {
  // KeyboardAvoidingView is a View subclass; we assert it exists in the tree
  const { getByTestId } = renderLogin();
  expect(getByTestId('auth-keyboard-view')).toBeTruthy();
});
```

If `renderLogin` helper doesn't exist, add one following the pattern in the existing test file (mock `@/lib/api/client` `login`, `expo-router`, etc.). Read the test file first to match its mocks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- login.test.tsx`
Expected: FAIL — `auth-keyboard-view` testID not found.

- [ ] **Step 3: Wrap login form in KeyboardAvoidingView**

In `mobile/src/app/auth/login.tsx`:

Add imports at the top (add to the `react-native` import block):
```typescript
  KeyboardAvoidingView,
  Platform,
```

Find the outermost container `View`/`ScrollView` of the screen. Wrap its contents in a `KeyboardAvoidingView` with `testID="auth-keyboard-view"`:

```tsx
      <KeyboardAvoidingView
        testID="auth-keyboard-view"
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* ...existing form content... */}
      </KeyboardAvoidingView>
```

If the screen uses a `ScrollView`, keep the `ScrollView` inside the `KeyboardAvoidingView` (the KAV wraps, ScrollView scrolls). The form inputs go inside.

- [ ] **Step 4: Run the login test to verify it passes**

Run: `npm test -- login.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add a failing test for register keyboard handling**

Append to `mobile/src/app/auth/__tests__/register.test.tsx`:

```typescript
it('wraps the form in a KeyboardAvoidingView', () => {
  const { getByTestId } = renderRegister();
  expect(getByTestId('auth-keyboard-view')).toBeTruthy();
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- register.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Wrap register form in KeyboardAvoidingView**

In `mobile/src/app/auth/register.tsx`, apply the same change as login (step 3): import `KeyboardAvoidingView` and `Platform`, wrap the form, add `testID="auth-keyboard-view"`.

- [ ] **Step 8: Run the register test to verify it passes**

Run: `npm test -- register.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/app/auth/login.tsx mobile/src/app/auth/register.tsx mobile/src/app/auth/__tests__/login.test.tsx mobile/src/app/auth/__tests__/register.test.tsx
git commit -m "feat(auth): add KeyboardAvoidingView to login and register forms"
```
