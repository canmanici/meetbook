# Task 11: Fix misleading home long-press comment

**Files:**
- Modify: `mobile/src/app/tabs/home.tsx` (file header comment + line 370 comment)

The file header comment claims `Long-press map → "Add book here" confirmation (§3.9)`, but `handleLongPress` (line 371) actually opens a **map-style picker** (Standart/Uydu/Hibrit). The comment lies about the behavior. "Add book here" is a fine feature idea but it's not built, and v1.0.1 doesn't build it. Fix the comment to match reality so the next dev isn't misled.

- [ ] **Step 1: Read the file header comment**

Run: `npm test --` (skip — this is a comment-only change with no test). Instead, verify the current comment text.

Read `mobile/src/app/tabs/home.tsx` lines 1-15 and line 370-393 to confirm the misleading text.

- [ ] **Step 2: Fix the header comment**

In `mobile/src/app/tabs/home.tsx`, find the file-header comment block (top of file). Search for the text "Add book here" or "§3.9" or "Long-press". Replace the misleading line(s) with an accurate description.

For example, if the header says:
```
 * Long-press map → "Add book here" confirmation (§3.9)
```
Change to:
```
 * Long-press map → map style picker (Standart / Uydu / Hibrit)
```

- [ ] **Step 3: Fix the inline comment**

At line 370, the comment reads:
```typescript
  // ── Long-press → map style picker (user preference) ───────────────────────
```
This one is actually **correct**. Leave it. Only the file-header comment is wrong. If the header doesn't mention long-press at all, there's nothing to fix — verify and move on.

- [ ] **Step 4: Verify no behavior changed**

Run: `npm test -- home.test.tsx`
Expected: PASS (comment change doesn't affect tests, confirms no accidental edit).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/tabs/home.tsx
git commit -m "docs(home): fix misleading long-press comment to match map-style-picker behavior"
```
