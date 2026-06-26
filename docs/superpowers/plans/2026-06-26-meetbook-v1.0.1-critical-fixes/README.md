# MeetBook v1.0.1 Critical Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task lives in its own file (`task-NN-*.md`) and is self-contained — a fresh subagent can execute it without reading the others. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 9 broken/dead-wired features shipping in the v1.0.0 APK and raise the polish floor (skeletons, KeyboardAvoidingView, pull-to-refresh, error states) so the app stops leaking professionalism in the details.

**Architecture:** Straightforward bug fixes + small polish additions inside the existing Expo Router + React Native + TanStack Query + Zustand stack. No new dependencies except `expo-image` (already in `package.json`, just unused). No backend changes. One new shared component (`BookCover`) and one new util (`formatDistance`) to DRY up repeated patterns.

**Tech Stack:** React Native 0.81, Expo SDK 54, expo-router 6, TanStack Query 5, Zustand 5, jest + @testing-library/react-native, expo-image, expo-haptics, expo-sharing.

---

## Scope — what this plan IS and IS NOT

**IS (v1.0.1):**
- The 9 broken-wiring bugs (no-op buttons, hardcoded values, inverted logic, dead taps, unreachable screens, misleading comments, unfinished strings, dead state).
- Cheap polish floor: `expo-image` swap, skeletons on the 3 spinner-only screens, `KeyboardAvoidingView` on auth forms, pull-to-refresh on remaining lists, error states with retry on screens that have none.

**IS NOT (separate future plans — do NOT scope-creep here):**
- i18n framework (`i18next`) — its own plan.
- KVKK data export / account deletion UI — its own plan.
- Trusted-contact setup screen (we only *remove* the dead menu item here).
- Voice messages (we only *remove* the dead mic button here).
- Dark-mode fixes for map styles — its own plan.
- Differentiator / out-of-the-box features — entirely separate.

---

## File Structure

**New files:**
- `mobile/src/components/ui/book-cover.tsx` — shared cover image (expo-image) with placeholder + fallback. DRYs up ~6 duplicated cover-rendering blocks.
- `mobile/src/lib/__tests__/format.test.ts` — tests for the new `formatDistance` util.
- Task-specific test files alongside each modified screen (see each task).

**Modified files (by task):**
| Task | File | What changes |
|---|---|---|
| 01 | `mobile/src/app/book/[id].tsx` | Wire share button (`Share.share`) |
| 02 | `mobile/src/app/book/[id].tsx` | Use real `distance_km` instead of "2.4 km" |
| 03 | `mobile/src/components/ui/book-cover.tsx` (new) + `index.ts` | Create `BookCover` component |
| 04 | `mobile/src/app/exchange/[id].tsx` | Fix inverted cover using `BookCover` |
| 05 | `mobile/src/app/chat/[id].tsx` | Wire ellipsis → `/chat/info/{id}` |
| 06 | `mobile/src/app/chat/[id].tsx` | Implement search-result scroll-to-message |
| 07 | `mobile/src/app/chat/[id].tsx` | Remove non-functional mic button |
| 08 | `mobile/src/app/wishlist/index.tsx` | Fix "exchange iste" → "Takas İste" |
| 09 | `mobile/src/app/wishlist/index.tsx` | Remove dead title/author state; smart isbn/title add |
| 10 | `mobile/src/app/tabs/profile.tsx` | Remove dead trusted-contact menu item |
| 11 | `mobile/src/app/tabs/home.tsx` | Fix misleading long-press comment |
| 12 | `mobile/src/app/book/[id].tsx`, `exchange/[id].tsx`, `chat/[id].tsx` | Add skeleton loading |
| 13 | `mobile/src/app/auth/login.tsx`, `register.tsx` | Add `KeyboardAvoidingView` |
| 14 | 5 list screens | Add `RefreshControl` pull-to-refresh |
| 15 | `requests.tsx`, `chats.tsx`, `wishlist/index.tsx`, `blocked-users.tsx` | Add error states with retry |
| 16 | `app.json`, run verification | Version bump 1.0.0 → 1.0.1, lint, full test suite |

---

## Execution Order

Tasks are designed to be **independent** — a fresh subagent can execute any single task. But if executing sequentially, follow this order to avoid merge conflicts on shared files:

**Group A — Broken-wiring bugs (do these first):**
1. `task-01-book-share.md`
2. `task-02-book-distance.md`
3. `task-03-book-cover-component.md` ← creates `BookCover`, needed by task 04
4. `task-04-exchange-cover.md` ← depends on task 03
5. `task-05-chat-ellipsis.md`
6. `task-06-chat-search-scroll.md`
7. `task-07-chat-mic-remove.md` ← tasks 05/06/07 all touch `chat/[id].tsx`; do them back-to-back
8. `task-08-wishlist-label.md`
9. `task-09-wishlist-dead-state.md` ← touches same file as 08; do back-to-back
10. `task-10-profile-trusted-remove.md`
11. `task-11-home-comment-fix.md`

**Group B — Polish floor:**
12. `task-12-skeletons.md`
13. `task-13-keyboard-avoiding.md`
14. `task-14-pull-to-refresh.md`
15. `task-15-error-states.md`

**Release:**
16. `task-16-verify-release.md` ← run last; verifies everything + bumps version

---

## Conventions for every task

- **TDD where it fits:** bug fixes get a failing test first that reproduces the bug, then the fix. Polish tasks (skeletons, pull-to-refresh) get a lighter "renders correctly" test.
- **One commit per task** using Conventional Commits (`fix:`, `feat:`, `style:`, `chore:`).
- **Run `npm test` from `mobile/`** for tests. Run `npm run lint` for lint.
- **Turkish strings stay Turkish** — this plan does NOT introduce i18n. Match existing string style.
- **Haptics:** add `expo-haptics` `impactAsync(ImpactFeedbackStyle.Light)` on interactive fixes where it improves feel (share, accept). Don't overdo it.
- **If a test mock is missing,** follow the mock pattern in `mobile/src/app/tabs/__tests__/home.test.tsx` (it's the most complete example).

---

## Self-Review (run after all tasks done)

1. **Spec coverage:** every bug in the README "9 broken features" table has a task. ✓ (tasks 01–11)
2. **Placeholder scan:** no TBD/TODO in any task file. ✓
3. **Type consistency:** `BookCover` props are identical everywhere (task 03 defines, task 04 consumes). `formatDistance` signature matches across definition (task 02) and usage. ✓
