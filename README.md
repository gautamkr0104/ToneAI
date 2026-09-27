# ToneAI

A production-oriented **native Android** AI assistant for Instagram DMs that
learns your texting style and drafts replies that sound like you. **AI drafts
are clearly identified and require your approval before anything is sent** —
sensitive drafts (money, health, legal, threats) are never auto-sent.

```
┌────────────────────┐   REST + Bearer JWT   ┌──────────────────────────┐
│  Android app       │ ────────────────────► │  Backend (Fastify/TS)    │
│  Kotlin/Compose M3 │ ◄──────────────────── │  PostgreSQL + Redis      │
│  Room offline cache│                       │  AIProvider (mock/OpenAI)│
└────────────────────┘                       │  InstagramProvider       │
        AI never runs on the phone           │   (official Graph / mock)│
                                             └──────────────────────────┘
```

## Repos layout

```
toneai/
  backend/          Fastify + TypeScript REST API (all AI + Instagram calls)
  android/          Kotlin + Jetpack Compose app (single :app module)
  docs/META_SETUP.md  Meta/Instagram official-API setup guide
  scripts/seed_demo.py  Optional demo data seeder (needs asyncpg + Postgres)
  .env.example      Backend environment template
  docker-compose.yml  Postgres + Redis + backend
```

## Quick start (backend)

```bash
cd backend
npm install
cp ../.env.example .env          # defaults work for local dev (mock AI + mock IG)
npm run migrate                  # or let the server migrate on boot
npm run dev                      # http://localhost:3000  (/health to verify)
npm test                         # 38 tests, DB-free
```

With Docker (Postgres + Redis + backend):

```bash
cp .env.example .env   # set JWT secrets at minimum
docker compose up --build
```

- `OPENAI_API_KEY` unset → deterministic **mock AI** (style emulation, classifier,
  embeddings) — everything works end-to-end.
- `INSTAGRAM_APP_ID/SECRET` unset → **mock Instagram** with 4 seeded threads;
  real connections use official OAuth only (see `docs/META_SETUP.md`).

## Quick start (Android)

1. Prereqs: JDK 17, Android SDK 34 (or Android Studio).
2. `android/local.properties` → `sdk.dir=<your SDK path>`.
3. The app talks to `BuildConfig.API_BASE_URL` (default `http://10.0.2.2:3000/`
   = host machine from the emulator). Change it in `android/app/build.gradle.kts`
   for a real device/server. Cleartext HTTP only works with the emulator loopback;
   use HTTPS in production.
4. Build:
   ```bash
   cd android
   ./gradlew assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
   ./gradlew testDebugUnitTest    # 7 unit tests
   ```
5. Install `app-debug.apk` on a device/emulator → sign up → Home →
   **Connect demo account** → Sync → open a DM → **Generate AI reply** → edit or
   tap a quick chip (SHORTER / FUNNIER / CASUAL / MATCH TONE) → **Approve & send**.

## API surface (v1)

Auth (register/login/refresh rotation/logout/me/delete-me) · Instagram accounts
(mock connect / OAuth start / callback / disconnect / sync) · Conversations
(list / messages / generate / regenerate / rewrite / send / settings) · Memories ·
Tone profile · Style examples · Settings & usage · Privacy (bulk delete, disable
learning/memory) · Automation rules · Webhooks (HMAC-verified) · Diagnostics.

Every request is ownership-checked (user + conversation owner + account owner)
to prevent IDOR. All endpoints are under the Bearer access token guard except
login/register/refresh and the webhook handshake.

## Security model

- **No Instagram passwords, ever.** Official OAuth only; long-lived tokens live
  server-side (envelope-encrypt with KMS before production).
- **Human-in-the-loop:** AI drafts are labeled; sending requires an explicit
  APPROVE action from the user; the backend re-classifies the text and blocks
  unreviewed sensitive sends (`sendApprovedMessage` guardrail).
- **Quotas:** per-user daily token + generation limits (cost control).
- **Privacy:** bulk-delete endpoints, disable learning/memory, cascade account
  delete. Logs redact tokens and message content by default
  (`LOG_MESSAGE_CONTENT=0`).
- **Refresh-token rotation** with revocation; single-use refresh tokens.

## Known limitations

- Release APK is unsigned (no signing config); debug APK is installable as-is.
- FCM notifications are a stub (`NOTIFICATION_PROVIDER=fcm` logs a warning) —
  plug `firebase-admin` for real push.
- Redis is wired via env but not yet required by any code path.
- Offline mode shows cached data and blocks sends (by design) — queued offline
  sending is not implemented.
- Mock AI produces template-style replies (good for demos, not production
  quality); set `OPENAI_API_KEY` for real replies.
- Tone profile auto-learning from sent messages is partially manual (sliders +
  style examples); continuous background learning is a next step.

## Future improvements

- Envelope encryption (KMS) for Instagram tokens; key rotation.
- WorkManager background sync + FCM push integration end-to-end.
- Room-backed queued offline sends with server confirmation flow.
- Instrumented Compose UI tests; CI (GitHub Actions) for backend tests + APK build.
- Story/reel comment replies via official permissions when available.
