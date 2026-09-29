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

## Incoming calls when the app is backgrounded/killed
- Backend sends a DATA-ONLY push (`incoming_call` with `expires_at`, ttl 30s;
  `call_cancelled` when the caller hangs up). The handler lives in
  `src/lib/background-handlers.ts`, registered from the entry file `index.js`
  (package.json `main`) — NOT from a route/_layout: a headless start never
  renders routes.
- The notification is NATIVE: `modules/incoming-call` (local Expo module) —
  Android CallStyle with system Answer/Decline, looping `meetbook_ringtone.ogg`
  at ring volume, `setTimeoutAfter(expires_at)`. Channel settings are frozen
  by Android: bump the channel id to change them.
- Lock screen: the full-screen intent opens `IncomingCallActivity` — a small
  native call screen with `showWhenLocked`/`turnScreenOn` declared in ITS
  manifest entry. NEVER make MainActivity show over the keyguard (manifest or
  runtime `setShowWhenLocked`): at runtime it raced with HyperOS (keyguard
  un-occluded ~20 ms later → hidden app ringing), and re-applying it on resume
  caused an endless flashing loop.
- Decline runs natively (`IncomingCallActions` → `POST /chat/calls/decline`
  with a token JS keeps fresh via `syncCallAuth`) and emits `onCallAction` so a
  running app drops its ringing state. Answer: the call screen asks for unlock
  (`requestDismissKeyguard`), then opens MeetBook with a pending "answer";
  CallManager `takeOverRingingNotification()` accepts once the offer arrives
  (the backend delivers it the instant the socket connects).
- A hidden/backgrounded app must never ring on its own: when the offer comes
  over a live socket while backgrounded, the native notification rings.

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
