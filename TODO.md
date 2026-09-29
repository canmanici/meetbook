# MeetBook — TODO

> **VDS constraint:** the server is already full. Do NOT add self-hosted
> services (mail server, extra databases, queues, monitoring stacks...).
> Prefer external free tiers (Brevo, Firebase, Sentry free) that add zero
> load to the VDS. Anything new must justify its RAM/CPU first.

## Now — before the next deploy
- [ ] **Email:** create a Brevo account (any email, not the personal Gmail),
      verify `canmanici.com` (SPF + DKIM DNS records), then set in Dokploy:
      `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`,
      `SMTP_PASSWORD` (Brevo SMTP key), `SMTP_FROM=MeetBook <no-reply@canmanici.com>`.
      Quick alternative for testing: a NEW dedicated Gmail + App Password.
      Without SMTP, new accounts can no longer verify (no auto-verify in prod).
- [ ] Dokploy: make sure `LOGIN_THROTTLE_ENABLED` / `RATE_LIMIT_ENABLED` are not
      set to `false` (defaults are now `true`).
- [ ] Optional: `MINIO_CONSOLE_ALLOWED_IPS=<your IP>/32` to open the MinIO
      console over HTTPS. Otherwise use `ssh -L 9001:127.0.0.1:9001 <server>`.
- [ ] Commit the work (credits, edu verification, course search, teachers,
      security fixes) — all still uncommitted.
- [ ] Build the APK and test on a phone: credits wallet, student verification
      (incl. sign-up step + skip), course search, teacher application, admin
      "Öğretmen Başvuruları" page.
- [ ] After that APK is out: `CREDITS_ENFORCED=true` in Dokploy.

## Demo stage (decided 2026-09-29)
- Student verification = **one-time codes from an approved teacher**
  (`POST /teachers/codes`, `POST /students/verify-code`). `.edu.tr` email
  verification is paused in the app (backend kept) — turn it back on once a
  university partners with us.
- [ ] Approve a demo teacher in the admin panel, issue codes, verify a student.

## Launch
- [ ] Ask 30–50 students on the target campus: books they'd give away, books
      they had to buy this semester, would they take-now / give-back-later?
- [ ] Pick ONE campus; seed 200–300 books before launch (seniors, clubs,
      "MeetBook Rafı" house shelf); pitch the library as handover point.
- [ ] Play Store closed testing (new personal accounts: 12 testers / 14 days).
- [ ] iOS build via EAS.

## Product / safety backlog
- [ ] Money filter in chat (price / IBAN / phone), like listings already have.
- [ ] Edition notes per course book ("did the old edition work?").
- [ ] Auto-flag a teacher badge for review after N complaints.
- [ ] Book-value-based loan deposits (flat 2 credits today).
- [ ] Admin token: move from localStorage to an HttpOnly cookie.
- [ ] Monitoring: Sentry free tier (external — no VDS load).
- [ ] SMS phone verification later, only if needed: Firebase Phone Auth
      (10 SMS/day free, needs Blaze plan). `.edu.tr` covers students for now.
- [ ] Fix the 24 pre-existing mobile test failures (home, requests,
      exchange detail, app-shell, book-marker).
