# Task 16: Final verification + version bump to 1.0.1

**Files:**
- Modify: `mobile/app.json` (version line 6)
- Modify: `mobile/package.json` (version line 3)

This is the release gate. Run the full test suite + lint, confirm everything green, bump the version, and verify no broken-wiring bugs remain.

- [ ] **Step 1: Run the full test suite**

Run from `mobile/`:
```bash
npm test
```
Expected: ALL tests PASS. If any test fails, STOP — go back and fix the task that introduced the failure. Do not bump the version with red tests.

- [ ] **Step 2: Run lint**

Run from `mobile/`:
```bash
npm run lint
```
Expected: no errors. Warnings are acceptable but note them. Fix any errors introduced by the changes (unused imports are the most likely — remove them, e.g. `title`/`author` imports removed in task 09, `Ionicons`/`Image` no longer used after BookCover swap in task 04).

- [ ] **Step 3: Verify no broken-wiring bugs remain**

Run a grep to confirm the 9 original bugs are gone. From `mobile/src/`:

```bash
rg -n "onPress=\{\(\) => \{\}\}" app/  # should return nothing (share button fixed)
rg -n "2\.4 km" app/                     # should return nothing (distance fixed)
rg -n "exchange iste" app/              # should return nothing (label fixed)
rg -n "route: null" app/                # should return nothing (trusted removed)
rg -n "TODO: scroll to message" app/    # should return nothing (search scroll fixed)
rg -n "📖" app/exchange/                # should return nothing (cover fixed via BookCover)
```

Each command should return **no matches**. If any returns a match, the corresponding task wasn't applied correctly — fix it.

Also verify the mic button is gone:
```bash
rg -n 'name="mic"' app/chat/            # should return nothing
```

- [ ] **Step 4: Bump version in app.json**

In `mobile/app.json`, line 6, change:
```json
    "version": "1.0.0",
```
to:
```json
    "version": "1.0.1",
```

- [ ] **Step 5: Bump version in package.json**

In `mobile/package.json`, line 3, change:
```json
  "version": "1.0.0",
```
to:
```json
  "version": "1.0.1",
```

- [ ] **Step 6: Bump root version references (if any)**

Check if the root `package.json` or `Meetbook.md` references a version. If they do and it should track the mobile version, bump them too. If not, skip.

Run:
```bash
rg -n "1\.0\.0" /home/can/Masaüstü/meetbook/README.md /home/can/Masaüstü/meetbook/Meetbook.md 2>/dev/null
```
Only bump references that are clearly the app version (not dependency versions).

- [ ] **Step 7: Final full test run after version bump**

Run from `mobile/`:
```bash
npm test
```
Expected: ALL PASS.

- [ ] **Step 8: Commit the release**

```bash
git add mobile/app.json mobile/package.json
git commit -m "chore(release): bump version to 1.0.1"
```

- [ ] **Step 9: (Optional) Tag the release**

If you use git tags for releases:
```bash
git tag -a v1.0.1 -m "v1.0.1: critical fixes and polish floor"
```

---

## Definition of Done (v1.0.1)

All of the following must be true:
- [ ] `npm test` passes with zero failures
- [ ] `npm run lint` passes with zero errors
- [ ] The 9 broken-wiring bugs are verified gone (step 3 greps return nothing)
- [ ] Skeletons replace spinners on book detail, exchange detail, chat detail
- [ ] KeyboardAvoidingView wraps login and register forms
- [ ] Pull-to-refresh works on user profile, wishlist, book detail, exchange detail, blocked-users
- [ ] Error states with retry render on requests, chats, wishlist, blocked-users
- [ ] Version is 1.0.1 in app.json and package.json
- [ ] All changes committed with conventional commit messages

Once DoD is met, the v1.0.1 APK can be built. Future work (i18n, KVKK, trusted-contact, voice messages, differentiators) goes in separate plans.
