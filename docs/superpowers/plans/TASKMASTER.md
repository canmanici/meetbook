# MEETBOOK TASKMASTER — Agent Swarm Dispatch

> **RULES FOR ALL AGENTS:**
> 1. **NO `npx test`** — do NOT run tests. Only check syntax with `npx tsc --noEmit` on files you changed.
> 2. **NO GIT** — do NOT commit, branch, stash, or touch git. Just edit files. The controller handles git.
> 3. **ONLY edit files listed in your task.** Do not touch any other file.
> 4. **Follow existing code patterns.** Read the file first, match the style.
> 5. **Turkish strings stay Turkish.** No i18n framework.
> 6. **When done, report:** DONE / BLOCKED + what you changed + files touched.

---

## SEND GROUP 1 — MAX PARALLEL (no file conflicts)

### T01: Strip unused Android permissions
**Files:** `mobile/app.json`, `mobile/android/app/src/main/AndroidManifest.xml`
**What:** The APK requests 13 permissions but only needs 8. Remove RECORD_AUDIO, USE_BIOMETRIC, USE_FINGERPRINT, WRITE_EXTERNAL_STORAGE, and SYSTEM_ALERT_WINDOW from the release build.
**How:**
- In `app.json`, remove `"android.permission.RECORD_AUDIO"` from the `android.permissions` array.
- In `AndroidManifest.xml`, add `tools:node="remove"` to strip permissions injected by dependencies:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
<uses-permission android:name="android.permission.USE_BIOMETRIC" tools:node="remove"/>
<uses-permission android:name="android.permission.USE_FINGERPRINT" tools:node="remove"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
```
- Keep: ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, CAMERA, INTERNET, VIBRATE, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE.
- Install `expo-build-properties` if not present: `npx expo install expo-build-properties` and add to plugins to strip RECORD_AUDIO from expo-camera config.

### T02: Wire chats tab unread badge
**Files:** `mobile/src/components/app-tabs.tsx`
**What:** The chats tab has no unread badge. Data exists from `listChats` query. Add a badge showing total unread count (capped at "99+"), same style as the requests tab badge.
**How:** Add a `useQuery` for `listChats` with `refetchInterval: 30000` (or reuse existing). Count unread from `data?.items.reduce((sum, c) => sum + (c.unread_count || 0), 0)`. Render a badge on the chats tab if count > 0, same pill style as requests badge.

### T03: Wire chat info screen — make all 8 stub rows functional
**Files:** `mobile/src/app/chat/info/[id].tsx`
**What:** 8 rows are no-op stubs: Wallpaper, Font size, Yıldızlı Mesajlar, Sabitlenmiş Mesajlar, Sohbette Ara, Sohbeti Dışa Aktar, Şikayet Et, Engelle. Only Mute works. Wire them all.
**How:**
- Wallpaper: show a row of 6 gradient options, store selection in `updateChatSettings({ wallpaper })`, apply as chat background color. For now just persist the choice.
- Font size: tappable row → Alert with 3 options (Küçük/Orta/Büyük), store in `updateChatSettings({ font_size })`.
- Yıldızlı Mesajlar: navigate to a placeholder view showing "Henüz yıldızlı mesaj yok" empty state.
- Sabitlenmiş Mesajlar: same placeholder pattern.
- Sohbette Ara: `router.push` to chat detail with search mode pre-activated (pass `?search=1` param).
- Sohbeti Dışa Aktar: generate text from messages, use `expo-sharing` to share a .txt file.
- Şikayet Et: navigate to a report sheet (reuse the report pattern from exchange/[id].tsx).
- Engelle: Alert confirm → call `blockUser` API → `router.back()`.

### T04: Profile avatar upload + name editing
**Files:** `mobile/src/app/tabs/profile.tsx`, `mobile/src/app/settings/index.tsx`
**What:** Profile has zero edit capability. Add an edit button on profile that opens an edit mode: avatar photo picker (expo-image-picker), name input, bio input. Save via `updateUser` API. Also fix settings "Profilimi Düzenle" to navigate to profile edit mode (not just profile view).
**How:**
- Add edit button (pencil icon) in profile hero.
- Edit mode: avatar with "change" overlay → `expo-image-picker` → upload via `updateUserAvatar`.
- Name TextInput (pre-filled), bio TextInput (new field, may need backend support — if no bio field, skip).
- Save button calls `updateUser({ name })` + avatar upload.
- Settings "Profilimi Düzenle" → `router.push('/tabs/profile?edit=1')`.

### T05: Blocked users — show real name + avatar
**Files:** `mobile/src/app/settings/blocked-users.tsx`
**What:** Every blocked user shows "?" as name. The API returns `user_id` and `created_at` but not user details. Fix by fetching each blocked user's profile via `getUser(user_id)` and showing their name + avatar.
**How:** For each blocked user, call `getUser(item.user_id)` (use `useQueries` or batch). Show Avatar with real name, block date below. Keep "Engeli Kaldır" button.

### T06: Home sheet empty state
**Files:** `mobile/src/app/tabs/home.tsx`
**What:** When no books found, the bottom sheet shows "0 kitap bulundu" text only — no designed empty state. Add a proper `EmptyState` component with an icon, message, and CTA.
**How:** Find the sheet list rendering. When `booksWithLocation.length === 0`, render `<EmptyState message="Bu bölgede kitap yok" description="Arama alanını genişlet veya filtreleri değiştir" icon="library-outline" />` inside the sheet instead of the count text.

### T07: Settings — wire all dead rows
**Files:** `mobile/src/app/settings/index.tsx`
**What:** Geri Bildirim Gönder and Gizlilik Politikası are non-interactive Views. Theme is display-only. No language selector. No about page.
**How:**
- Geri Bildirim Gönder → `Linking.openURL('mailto:support@meetbook.com')`.
- Gizlilik Politikası → `Linking.openURL('https://canmanici.com/meetbook/privacy')`.
- Theme: make tappable → 3 options (Sistem/Aydınlık/Karanlık) via Alert → store in AsyncStorage → apply via `useColorScheme` override.
- Add "Dil" row → display-only "Türkçe" (no i18n, just shows current language).
- Add "Hakkında" row → Alert with version, build, credits.
- Add "Önbelleği Temizle" row → clears expo-image cache.
- Make all rows actual `TouchableOpacity` with `onPress`.

### T08: Real empty state on home sheet
**Files:** `mobile/src/app/tabs/home.tsx`
**NOTE:** If T06 is in the same group, merge with T06. Otherwise this is the same task.
**SKIP — merged into T06.**

### T09: Haptics on all interactive actions
**Files:** `mobile/src/app/tabs/requests.tsx`, `mobile/src/app/tabs/my-books.tsx`, `mobile/src/app/wishlist/index.tsx`, `mobile/src/app/book/[id].tsx`, `mobile/src/app/exchange/[id].tsx`
**What:** Only home.tsx uses haptics. Add `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` on every accept/reject/send/toggle/delete/favorite action.
**How:** Import `* as Haptics from 'expo-haptics'` in each file. Add `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` as the first line of every `onPress` handler for buttons that trigger mutations (accept, reject, cancel, complete, favorite, delete, add, remove).

### T10: Accessibility labels on all interactive elements
**Files:** `mobile/src/app/tabs/requests.tsx`, `mobile/src/app/tabs/chats.tsx`, `mobile/src/app/tabs/my-books.tsx`, `mobile/src/app/book/[id].tsx`, `mobile/src/app/exchange/[id].tsx`, `mobile/src/app/chat/[id].tsx`, `mobile/src/app/wishlist/index.tsx`
**What:** Most touchables lack `accessibilityLabel` and `accessibilityRole`. Add them to every `TouchableOpacity` and `Pressable`.
**How:** For each `TouchableOpacity`, add `accessibilityLabel="descriptive Turkish label"` and `accessibilityRole="button"`. Example: accept button gets `accessibilityLabel="Talebi kabul et"`, share button gets `accessibilityLabel="Kitabı paylaş"`.

---

## SEND GROUP 2 — MAX PARALLEL (no file conflicts with Group 1)

### T11: Forgot password flow
**Files:** `mobile/src/app/auth/login.tsx`, `mobile/src/app/auth/forgot-password.tsx` (new)
**What:** Login has no "forgot password" link. Add a "Şifremi Unuttum" link below the login button. Create a forgot-password screen: email input → call `requestPasswordReset` API → show "E-postanı kontrol et" success state.
**How:**
- In login.tsx, add `<TouchableOpacity onPress={() => router.push('/auth/forgot-password')}><Text>Şifremi Unuttum</Text></TouchableOpacity>` below the login button.
- Create `forgot-password.tsx`: email input, submit button, calls `requestPasswordReset({ email })`, on success shows checkmark + "E-postana sıfırlama bağlantısı gönderildi", on error shows inline error.
- Add route to `auth/_layout.tsx`.

### T12: Password strength meter on register
**Files:** `mobile/src/app/auth/register.tsx`
**What:** No password strength indicator. Add a visual strength bar that updates as the user types their password.
**How:**
- Add a strength calculation function: score based on length (≥8), has uppercase, has number, has special char. 0-4 scale: ZayıF/Orta/İyi/Güçlü.
- Render a 4-segment bar below the password input. Color: red/orange/yellow/green. Show label text.
- Only show when password field has text.

### T13: Email validation on auth forms
**Files:** `mobile/src/app/auth/login.tsx`, `mobile/src/app/auth/register.tsx`
**What:** Only checks non-empty. Add real email format validation.
**How:**
- Add a `isValidEmail(email)` function: `const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; return EMAIL_RE.test(email)`.
- In login: show InlineError "Geçerli bir e-posta adresi girin" when email is non-empty but invalid.
- In register: same. Disable submit button when email is invalid.

### T14: Password visibility toggle
**Files:** `mobile/src/app/auth/login.tsx`, `mobile/src/app/auth/register.tsx`
**What:** No eye icon to show/hide password. Add a toggle.
**How:**
- Add `const [showPassword, setShowPassword] = useState(false)` state.
- In the password Input, add a right-affix button: `<TouchableOpacity onPress={() => setShowPassword(!showPassword)}><Ionicons name={showPassword ? 'eye-off' : 'eye'} /></TouchableOpacity>`.
- Set `secureTextEntry={!showPassword}` on the input.

### T15: Onboarding flow — first-run
**Files:** `mobile/src/app/onboarding/index.tsx` (new), `mobile/src/app/onboarding/_layout.tsx` (new), `mobile/src/app/_layout.tsx`
**What:** No first-run onboarding. Location/camera/push permissions are cold-requested. Add a 3-slide onboarding that explains the app, then requests permissions.
**How:**
- Create `onboarding/` route group with 3 slides:
  1. "Kitaplarını paylaş, yakınlarındaki kitapları bul" (book exchange concept)
  2. "Güvenli buluşma noktaları" (safety feature)
  3. "Konum izni gerekli" (location permission explanation)
- Slide 3 has a "Başla" button that requests location permission then navigates to home.
- In `_layout.tsx`, check AsyncStorage for `hasOnboarded`. If not, redirect to `/onboarding`. Set `hasOnboarded` after completion.

### T16: In-app notification center
**Files:** `mobile/src/app/notifications/index.tsx` (new), `mobile/src/app/notifications/_layout.tsx` (new), `mobile/src/components/app-tabs.tsx`
**What:** No in-app notification center. Add a bell icon in the home header that opens a notifications list.
**How:**
- Create `notifications/` route with a FlatList of notification items (icon, title, body, time, read/unread).
- Call `listNotifications` API (if exists) or create a mock structure.
- Add bell icon with unread badge to home header.
- Tapping a notification navigates to the relevant screen (exchange detail, chat, etc.).

### T17: Dark mode map styles
**Files:** `mobile/src/app/tabs/home.tsx`, `mobile/src/app/book/location-picker.tsx`, `mobile/src/app/meetup/select-place.tsx`
**What:** Map styles hardcode `palette.light`. Fix to follow system dark mode.
**How:**
- In each file, find where `MAP_STYLE` or map background is set. Use `const isDark = scheme === 'dark'` (already exists in most files). Pass dark map style JSON when dark.
- For `location-picker.tsx`: replace `palette.light` with `colors` (the theme-aware variable).
- For home: the `MAP_STYLE` constant should switch based on `isDark`.

### T18: User-overridable theme toggle
**Files:** `mobile/src/app/settings/index.tsx`, `mobile/src/stores/theme-store.ts` (new), `mobile/src/app/_layout.tsx`
**What:** Theme is system-only. Add a user toggle: Sistem/Aydınlık/Karanlık. Store preference in Zustand + AsyncStorage. Override `useColorScheme` app-wide.
**How:**
- Create `theme-store.ts`: `theme: 'system' | 'light' | 'dark'`, persisted to AsyncStorage.
- In `_layout.tsx`, compute effective scheme: if `theme === 'system'`, use `useColorScheme()`, else use `theme`.
- In settings, make the theme row tappable → 3-option Alert.
- Pass the effective scheme down via context or use the store directly in screens.

### T19: Consistent confirmation pattern — replace Alert with toast
**Files:** `mobile/src/app/tabs/requests.tsx`, `mobile/src/app/exchange/[id].tsx`, `mobile/src/app/settings/blocked-users.tsx`, `mobile/src/app/settings/index.tsx`
**What:** Some screens use `Alert.alert` for confirmations, others use toast. Standardize to toast for non-destructive actions, keep Alert only for destructive (delete, block, logout).
**How:**
- For accept/reject exchange: replace `Alert.alert` with direct mutation + toast feedback ("Talep kabul edildi" / "Talep reddedildi").
- For unblock: keep Alert confirm (destructive adjacent).
- For logout: keep Alert confirm (destructive).
- Import `useToast` and call `toast.show({ message, variant })` after mutations.

---

## SEND GROUP 3 — features that build on Group 1+2

### T20: expo-image swap everywhere
**Files:** `mobile/src/app/tabs/my-books.tsx`, `mobile/src/app/tabs/home.tsx`, `mobile/src/app/user/[id].tsx`, `mobile/src/app/wishlist/index.tsx`, `mobile/src/components/ui/bottom-sheet-preview.tsx`, `mobile/src/components/map/marker-preview-card.tsx`
**What:** Remote images still use raw `<Image>` from react-native. Swap all to `BookCover` or `expo-image` Image for caching + shimmer + fallback.
**How:**
- Find every `<Image source={{ uri: ... }}>` in these files.
- Replace with `<BookCover url={...} size={...} />` (from `@/components/ui`).
- For non-book images (avatars), use `<Image>` from `expo-image` directly with `cachePolicy="memory-disk"`.

### T21: Trusted contact setup screen
**Files:** `mobile/src/app/settings/trusted-contact.tsx` (new), `mobile/src/app/settings/_layout.tsx`, `mobile/src/app/tabs/profile.tsx`
**What:** We removed the dead "Güvendiğim Kişi" menu item. Now build the real feature: pick a phone number → that person gets meetup details via SMS.
**How:**
- Create `trusted-contact.tsx`: phone number input with TR format validation, name input, save button.
- Save via `updateUser({ trusted_contact_name, trusted_contact_phone })`.
- Show current trusted contact if set, with "Değiştir" and "Kaldır" buttons.
- Add menu item back in profile: "Güvendiğim Kişi" → `/settings/trusted-contact`.
- Add to `settings/_layout.tsx` Stack.

### T22: KVKK data export
**Files:** `mobile/src/app/settings/index.tsx`, `mobile/src/app/settings/data-export.tsx` (new)
**What:** Turkish law requires users to export their data. Add "Verilerimi İndir" in settings.
**How:**
- Add "Verilerimi İndir" row in settings → `/settings/data-export`.
- Create `data-export.tsx`: explanation text + "İndir" button.
- Button calls `requestDataExport` API (or generates a summary JSON locally if no API).
- On success, use `expo-sharing` to save/share the file.
- Show "İstek alındı, 48 saat içinde hazırlanacak" message.

### T23: KVKK account deletion
**Files:** `mobile/src/app/settings/index.tsx`, `mobile/src/app/settings/delete-account.tsx` (new)
**What:** Turkish law requires account deletion. Add "Hesabımı Sil" in settings danger zone.
**How:**
- Add "Hesabımı Sil" row in settings (red, danger style) → `/settings/delete-account`.
- Create `delete-account.tsx`: warning text explaining PII will be anonymized but exchange skeleton kept, password confirmation input, "Kalıcı olarak sil" button.
- Button calls `deleteAccount({ password })` API → on success: clear tokens, clear session, replace to login.
- Two-step confirmation: Alert "Emin misiniz? Bu geri alınamaz."

### T24: Flashlight toggle on ISBN scanner
**Files:** `mobile/src/app/book/scan-isbn.tsx`
**What:** No flashlight toggle. Add a torch button.
**How:**
- Add `const [torch, setTorch] = useState(false)` state.
- Add a button (top-right) that toggles `torch`.
- Pass `torchMode={torch ? 'on' : 'off'}` to `CameraView`.
- Use Ionicons `flashlight` / `flashlight-outline` icon.

### T25: Manual ISBN entry fallback on scanner
**Files:** `mobile/src/app/book/scan-isbn.tsx`
**What:** If scan fails, user is stuck. Add a "Manuel gir" button.
**How:**
- Add a "Manuel ISBN Gir" button at the bottom.
- Tapping it shows a TextInput with ISBN validation (same regex as wishlist).
- On valid ISBN, `setScannedISBN` and `router.back()` — same as scan success.

### T26: Swipe gestures on requests
**Files:** `mobile/src/app/tabs/requests.tsx`
**What:** No swipe actions. Add swipe-left to reject, swipe-right to accept on incoming request rows.
**How:**
- Use `react-native-gesture-handler` `Swipeable` component.
- Left swipe reveals red "Reddet" background.
- Right swipe reveals green "Kabul Et" background.
- On swipe complete, trigger the mutation.

### T27: Filter by status on requests
**Files:** `mobile/src/app/tabs/requests.tsx`
**What:** No status filter. Add a filter row: Tümü / Beklemede / Onaylandı / Tamamlandı.
**How:**
- Add a horizontal ScrollView of filter chips below the Gelen/Giden tabs.
- Filter the `items` array client-side by `status` field.
- Active chip has primary background.

### T28: Chats — swipe to archive + pin
**Files:** `mobile/src/app/tabs/chats.tsx`
**What:** No swipe actions. Add swipe-left to archive, swipe-right to pin.
**How:**
- Wrap each `ChatItem` in `Swipeable`.
- Left swipe: orange "Arşivle" background.
- Right swipe: blue "Sabitle" background.
- Pin moves chat to top with a pin icon.

### T29: My-books stats dashboard
**Files:** `mobile/src/app/tabs/my-books.tsx`
**What:** No stats. Add a collapsible stats header: total views, most-viewed book, avg requests per book.
**How:**
- Add a stats card at the top of the list (collapsible).
- Show: "X toplam görüntülenme", "En popüler: {title}", "Ortalama X talep".
- Compute from `books` array: sum `view_count`, find max, calculate avg `pending_requests`.

### T30: Book detail — similar books nearby
**Files:** `mobile/src/app/book/[id].tsx`
**What:** No "similar books" section. Add "Yakınındaki Benzer Kitaplar" section showing 3-5 books in the same category within search radius.
**How:**
- After the book info card, add a section that calls `searchNearbyBooks({ category: book.category, limit: 5 })`.
- Horizontal ScrollView of mini book cards (cover, title, distance).
- Tapping navigates to that book's detail.
- Hide if no results.

### T31: Book detail — owner's other books
**Files:** `mobile/src/app/book/[id].tsx`
**What:** No "owner's other books" section. Add "{owner_name}'in Diğer Kitapları" showing their other listings.
**How:**
- Call `searchNearbyBooks({ owner_id: book.owner_id, limit: 10 })` (excluding current book).
- Horizontal ScrollView of mini book cards.
- Hide if owner has no other books.

### T32: Exchange detail — meetup reschedule history
**Files:** `mobile/src/app/exchange/[id].tsx`
**What:** No reschedule history. Show a timeline of meetup changes (who proposed, when, accepted/rejected).
**How:**
- Add a "Geçmiş" section below the meetup card.
- Show each meetup proposal as a row: proposer name, place name, date/time, status badge.
- Most recent first.

### T33: Push permission request UI
**Files:** `mobile/src/app/notifications/index.tsx` (if T16 exists) or `mobile/src/app/tabs/home.tsx`
**What:** No push permission prompt. Add a banner on first launch asking to enable notifications.
**How:**
- Use `expo-notifications` `requestPermissionsAsync()`.
- Show a dismissible banner on home: "Bildirimleri açın, yeni talepleri anında öğrenin" with "İzin Ver" button.
- On allow, call `registerForPushNotifications` and send token to backend.
- Store `hasAskedPushPermission` in AsyncStorage so we only ask once.

### T34: Offline tolerance with netinfo
**Files:** `mobile/src/lib/query-client.ts`, `mobile/src/components/app-error-boundary.tsx`
**What:** No offline awareness. Add `@react-native-community/netinfo` to detect connectivity and queue mutations.
**How:**
- Install `@react-native-community/netinfo`.
- In `query-client.ts`, add `onlineManager` integration with NetInfo.
- Add a global "Çevrimdışı" banner when no connection.
- Mutations show "İnternet bağlantısı yok, tekrar denenecek" toast instead of failing silently.

### T35: Analytics events
**Files:** `mobile/src/lib/analytics.ts` (new), multiple screens
**What:** Zero analytics. Add a lightweight analytics layer.
**How:**
- Create `analytics.ts` with `track(event, properties)` function. For now, just `console.log` in dev and send to backend `/api/v1/analytics` in prod.
- Add key events: `book_viewed`, `book_listed`, `exchange_requested`, `exchange_accepted`, `meetup_proposed`, `chat_sent`, `app_open`.
- Call `track()` at the relevant points in each screen.

---

## SEND GROUP 4 — differentiator features

### T36: Book journey / history
**Files:** `mobile/src/app/book/[id].tsx`, `mobile/src/components/ui/book-journey.tsx` (new)
**What:** Every book that's been exchanged has a history. Show "Bu Kitabın Yolculuğu" section: list of past owners, dates, one-line reviews.
**How:**
- Add a section in book detail (for books with exchange history).
- Call `getBookHistory(bookId)` API (or derive from exchanges).
- Show timeline: avatar → name → date → one-line review.
- If no history, show "Bu kitabın yolculuğu yeni başlıyor" message.

### T37: Reading compatibility score
**Files:** `mobile/src/app/user/[id].tsx`, `mobile/src/lib/compatibility.ts` (new)
**What:** Show "82% okuma zevki uyumu" on user profiles based on genre/author overlap.
**How:**
- Create `compatibility.ts`: compare two users' book categories. Score = (intersection / union) * 100.
- Call `getUser(id)` + `listMyBooks()` to get both users' libraries.
- Show score as a circular progress + label on user profile.
- If score > 85%, show "Kitap İkizi!" badge.

### T38: Public bookshelf on profile
**Files:** `mobile/src/app/tabs/profile.tsx`, `mobile/src/app/user/[id].tsx`
**What:** Profile is just a menu. Make it a showcase: hero with stats + bookshelf grid showing all listed books.
**How:**
- Redesign profile: gradient hero (avatar, name, stats) → bookshelf grid (2 columns) → menu items at bottom.
- Each book in the grid shows cover, title, availability badge.
- Tapping a book navigates to book detail.
- Same for public profile (`user/[id].tsx`).

### T39: Annual book year-in-review
**Files:** `mobile/src/app/year-in-review/index.tsx` (new), `mobile/src/app/tabs/profile.tsx`
**What:** Spotify-Wrapped style annual summary: books exchanged, km walked, people met, cities reached.
**How:**
- Create `year-in-review/` route with animated slides.
- Slide 1: "X kitap takas ettin" (big number animation).
- Slide 2: "X km yürüdün" (map visualization).
- Slide 3: "X yeni kişiyle tanıştın" (avatar grid).
- Slide 4: "Kitapların X şehre ulaştı" (map).
- Slide 5: Shareable card "2026 Kitap Yılım" with Instagram-style export.
- Add "Yılın Özeti" menu item in profile (visible if user has ≥1 completed exchange).

### T40: Safety companion mode
**Files:** `mobile/src/app/exchange/[id].tsx`, `mobile/src/lib/safety.ts` (new)
**What:** During meetup window, opt-in to share live location with trusted contact. If you stop moving 10 min, they get an alert.
**How:**
- When meetup is confirmed, show "Güvenlik Modu" toggle.
- On enable: request background location permission, start sharing location with backend every 60s for ±30 min around meetup time.
- Backend checks: if no movement for 10 min, send push to trusted contact.
- Show "Güvenlik modu aktif" badge with countdown timer.
- Auto-disable 30 min after meetup time.

### T41: Post-meetup check-in
**Files:** `mobile/src/app/exchange/[id].tsx`
**What:** After meetup time passes, ask "Her şey yolunda mı?" → feeds trust system.
**How:**
- 1 hour after meetup time, show a card: "Buluşma nasıl geçti?" with 3 buttons: "Harikaydı" / "İdare eder" / "Sorun oldu".
- "Sorun oldu" → opens report flow.
- "Harikaydı" / "İdare eder" → increments trust score, dismisses card.
- Store response in exchange record.

### T42: Meetup countdown + checklist
**Files:** `mobile/src/app/exchange/[id].tsx`
**What:** No countdown to meetup. Add a visual timer + prep checklist.
**How:**
- When meetup is confirmed, show countdown timer: "Buluşmaya X saat X dakika".
- Below timer, checklist: "☑ Kitapı hazırla", "☐ Telefonun şarjı dolu", "☐ Arkadaşına haber ver".
- Checklist items stored in AsyncStorage per exchange ID.

### T43: Heatmap overlay on home map
**Files:** `mobile/src/app/tabs/home.tsx`
**What:** Show density of books on the map as a heatmap.
**How:**
- Add a toggle button in right controls: "Yoğunluk" (heatmap icon).
- When enabled, render a heatmap layer using book cluster data.
- Use MapLibre `HeatmapLayer` with the cluster points as source.
- Color gradient: blue (sparse) → green → yellow → red (dense).

### T44: Saved searches with push
**Files:** `mobile/src/app/tabs/home.tsx`, `mobile/src/app/saved-searches/index.tsx` (new)
**What:** Let users save a search (category + radius + location) and get notified when new books match.
**How:**
- Add "Aramayı Kaydet" button when filters are active.
- Save search params to backend `POST /saved-searches { category, radius_km, location }`.
- Backend runs a worker that checks for new matches and sends push.
- Add "Kayıtlı Aramalar" in profile/saved-searches route showing list with match counts.

### T45: Smart replies in chat
**Files:** `mobile/src/app/chat/[id].tsx`
**What:** No quick reply suggestions. Add 3 contextual suggestion chips above the input.
**How:**
- Analyze the last incoming message for keywords:
  - Contains "saat" or "vakit" → suggest "14:00 olur", "Hangi saat?"
  - Contains "nerede" or "yer" → suggest "Sen nerede istersin?", "Kafe'de buluşalım"
  - Contains "?" → suggest "Evet", "Hayır", "Tabi"
- Show as horizontal pill chips above input bar.
- Tapping a chip fills the input with that text.

### T46: In-chat book card sharing
**Files:** `mobile/src/app/chat/[id].tsx`, `mobile/src/components/ui/book-card-message.tsx`
**What:** Can't send a book listing in chat. Add a book icon in the input bar that opens the user's library → tap a book → sends a book card message.
**How:**
- Add book icon button next to emoji button in input bar.
- Tapping opens a bottom sheet with user's book list (`listMyBooks`).
- Tapping a book calls `sendMessage({ type: 'book_card', book_id })`.
- Recipient sees a `BookCardMessage` with cover, title, "İncele" button → navigates to book detail.

### T47: Book club mode (group swap)
**Files:** `mobile/src/app/chat/club/[id].tsx` (new), `mobile/src/app/tabs/chats.tsx`
**What:** 3-5 people meet, everyone brings 1 book, everyone leaves with 1. Group exchange.
**How:**
- Add "Kitap Kulübü Oluştur" button in chats list.
- Create group chat with up to 5 members.
- Each member adds 1 book to the "pool".
- On meetup day, shuffle books randomly and assign.
- Show assignment in chat: "Sana {book} kaldı!"

### T48: Shelf scan (ML book detection)
**Files:** `mobile/src/app/book/shelf-scan.tsx` (new), `mobile/src/app/book/new.tsx`
**What:** Camera scan of physical shelf → ML detects spines → pre-fills multiple books.
**How:**
- Create `shelf-scan.tsx` with camera view.
- Use on-device ML (Google ML Kit or `expo-camera` frame processing) to detect book spines.
- For each detected spine, try ISBN lookup or title search.
- Show detected books as a checklist → user confirms which to add.
- Batch-create all selected books.
- Note: this is advanced — if ML setup is too complex, fall back to rapid multi-photo ISBN scan.

### T49: Book passport
**Files:** `mobile/src/app/tabs/profile.tsx`, `mobile/src/components/ui/book-passport.tsx` (new)
**What:** Each exchange stamps a virtual passport. Show collection of stamps (cities, dates).
**How:**
- Add "Kitap Pasaportu" section in profile.
- For each completed exchange, show a stamp: city name + date + book emoji.
- Stamps arranged in a grid with passport-style design.
- Count total: "X şehir, X kitap".

### T50: Reading identity card (shareable)
**Files:** `mobile/src/app/tabs/profile.tsx`, `mobile/src/components/ui/reading-identity.tsx` (new)
**What:** Auto-generated "you are 67% literary fiction / 20% sci-fi / 13% poetry" card, shareable to Instagram.
**How:**
- Analyze user's completed exchanges + wishlist by category.
- Generate percentage breakdown.
- Render as a visually striking card (gradient background, big percentages, book icon).
- "Paylaş" button → `expo-sharing` or `Share.share` with image.

---

## PRIORITY ORDER FOR DISPATCH

**SEND GROUP 1 (T01-T10):** Permissions fix + table-stakes bugs. Max parallel — no file conflicts.
**SEND GROUP 2 (T11-T19):** Auth improvements + settings + dark mode. Max parallel — no conflicts with Group 1.
**SEND GROUP 3 (T20-T35):** Feature completions + QoL. Max parallel — no conflicts with Group 2.
**SEND GROUP 4 (T36-T50):** Differentiators. These are the "put us on the map" features.

---

## AGENT DISPATCH RULES

1. **One task per agent.** No agent does two tasks.
2. **No git.** Agents edit files only. Controller commits.
3. **No tests.** Agents run `npx tsc --noEmit` on their files only. If syntax passes, task passes.
4. **Read before write.** Agent reads the target file(s) first, then edits.
5. **Report format:** DONE/BLOCKED + files touched + what changed.
6. **File conflict check:** No two agents in the same send group touch the same file. Controller verifies before dispatch.
7. **Speed over perfection.** New-grad style: simple, direct, fast. Don't overthink. Don't refactor. Just implement.
