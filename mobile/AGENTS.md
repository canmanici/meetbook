# MeetBook Mobile — Agent Notes

Expo 54 (dev-client, NOT Expo Go-only) + expo-router + zustand + react-query.
Design system: `src/components/ui/tokens.ts` (`radius.input` is test-locked to 8 —
change values / add keys, never rename).

## Calls (WebRTC)
- Native deps: `react-native-webrtc`, `react-native-incall-manager` — exist only
  in dev-client/release builds. NEVER import them directly; always go through
  the lazy loader `src/lib/webrtc.ts` (`getWebRTC()` / `getInCallManager()` return
  null in Expo Go/web/Jest and the call UI hides itself via `isCallSupported()`).
- Signaling: chat WebSocket (`chatWS.sendCall`), events
  `offer|answer|ice|end|reject|cancel|busy`. State machine lives in
  `src/stores/call-store.ts`; UI in `src/app/call.tsx`; incoming-call navigation
  in `src/components/call-manager.tsx` (mounted in `_layout.tsx`).
- ICE servers come from `GET /chat/turn-credentials` (ephemeral 1h HMAC TURN
  creds, cached in call-store) with a STUN-only fallback. Do not hardcode TURN
  credentials anywhere — the backend mints them.
- Call history renders as `system` messages with `extra.action === 'call_log'`
  (handled inline in `src/app/chat/[id].tsx`).
- After touching native deps or app.json plugins: rebuild the APK
  (`npm run build:android-apk` or the local gradle toolchain). Metro is not enough.

- Ringback: the CALLER hears `assets/sounds/incallmanager_ringback.mp3`
  (450 Hz düt-düt), copied into `res/raw` by `plugins/with-call-sounds.js`.
  Without that raw resource incall-manager falls back to the phone's own
  RINGTONE. The callee keeps `_DEFAULT_` (the phone's real ringtone).
- Callee answers `offer` with a `ringing` event → caller UI shows "Çalıyor…".

## Chat gotchas
- The chat WebSocket is APP-GLOBAL (also the call-signaling channel):
  CallManager opens it on login and `useChatStore.disconnect()` is for logout
  only. Never disconnect on screen blur — that killed incoming calls.
  `useChatStore.connect()` subscribes once for the app lifetime.
- Optimistic sends carry `client_id` (= the `temp-` id); the backend echoes it
  on the message broadcast or on the `error`, and `addMessage` reconciles by
  it. The text-match fallback reconciles exactly ONE temp message — don't
  revert to blanket temp filtering (it eats rapid-fire messages).
- Typing events are throttled (≥2.5s apart) in `chat/[id].tsx`.
- Tests mock expo-router per-file; any new hook used in a screen
  (`useFocusEffect`, `usePathname`, …) must be added to that screen's test mock.
  `chats.tsx` needs `ToastProvider` in its test render wrapper.
