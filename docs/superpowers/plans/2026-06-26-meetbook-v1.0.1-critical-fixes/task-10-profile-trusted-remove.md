# Task 10: Remove dead trusted-contact menu item

**Files:**
- Modify: `mobile/src/app/tabs/profile.tsx` (MENU_ITEMS at line 29)
- Test: `mobile/src/app/tabs/__tests__/profile.test.tsx` (append)

The profile menu has `{ key: 'trusted', label: 'Güvendiğim Kişi', route: null }`. The tap handler is `onPress={() => item.route && router.push(...)}` — so tapping does **nothing**. A dead tap on a **safety feature** is worse than not having the entry: it erodes trust. The full trusted-contact setup (pick a phone number, send meetup details via SMS) is a separate feature plan. For v1.0.1, **remove the menu item** so the UI stops lying.

- [ ] **Step 1: Add a failing test**

Open `mobile/src/app/tabs/__tests__/profile.test.tsx`. Append inside the existing `describe`:

```typescript
it('does not show a dead "Güvendiğim Kişi" menu item', async () => {
  const { queryByText } = renderProfile();
  await waitFor(() => expect(queryByText('Güvendiğim Kişi')).toBeNull());
});
```

If `renderProfile` helper doesn't exist yet, add one mirroring `renderHome` from `home.test.tsx` (mock `@/lib/api/client` for `getMe`, `getUser`, `listMyBooks`, `logout`, `updateGeofenceRadius`; mock `expo-router`, `react-native-safe-area-context`, `expo-haptics`, `expo-linear-gradient`). Use the existing test file's patterns — read it first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- profile.test.tsx`
Expected: FAIL — "Güvendiğim Kişi" is rendered (the dead item exists).

- [ ] **Step 3: Remove the menu item**

In `mobile/src/app/tabs/profile.tsx`, find the `MENU_ITEMS` array (lines 28-33). Remove the `trusted` entry. The array becomes:

```typescript
const MENU_ITEMS = [
  { key: 'blocked', label: 'Engellenen Kullanıcılar', icon: 'ban' as const, tint: 'coral' as PastelName, route: '/settings/blocked-users' as const },
  { key: 'wishlist', label: 'İstek Listem', icon: 'heart' as const, tint: 'blush' as PastelName, route: '/wishlist' as const },
  { key: 'settings', label: 'Ayarlar', icon: 'settings-sharp' as const, tint: 'sky' as PastelName, route: '/settings' as const },
] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- profile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/tabs/profile.tsx mobile/src/app/tabs/__tests__/profile.test.tsx
git commit -m "fix(profile): remove dead 'Güvendiğim Kişi' menu item (separate feature plan)"
```
