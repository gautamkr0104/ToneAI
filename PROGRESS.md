# ToneAI — Build Progress & Resume Notes

_Saved: end of Day 2 session. Resume from "NEXT STEPS" at the bottom._

---

## ORIGINAL TASK (summary of user's requirements)

Build **ToneAI** — a production-oriented native Android AI assistant for Instagram DMs that learns the user's texting style and generates replies that sound like the user.

**Hard rules from the prompt (must keep honoring):**
- Native Android: Kotlin + Jetpack Compose + Material 3, MVVM/Clean Architecture
- AI runs on backend/cloud only — never on the phone, never in the APK
- NO scraping, NO private/reverse-engineered Instagram APIs, NO Accessibility Services, NO UI automation, NO Instagram passwords ever
- Official Meta/Instagram OAuth + supported messaging APIs only; if Meta permission unavailable → provider abstraction + MockInstagramProvider + docs
- AI drafts clearly identified; human approval default; never auto-send sensitive/financial/legal/medical/threatening messages
- Backend: TypeScript + Node + REST + PostgreSQL (+Redis where useful) + provider abstractions (AIProvider, MessagingProvider/InstagramProvider, NotificationProvider, MemoryProvider)
- 17 Android screens, dark/light, offline states, etc.
- Data isolation: every request checks user + owner + account owner (no IDOR)
- Must actually run `./gradlew assembleDebug`, produce APK, run tests, fix errors, then give final report (BUILD STATUS / APK PATH / etc.)
- Full prompt is in the conversation; this file captures the essentials.

---

## ENVIRONMENT (this Windows machine)

- Windows, bash shell. Repo root: `D:\vs code projects\` — ToneAI lives in `toneai/`.
- Node v24.19.0 present. No Docker. Network OK.
- **Toolchain at `C:/toneai-tools`:**
  - JDK 17: `C:/toneai-tools/jdk-17.0.20.1+1`
  - Gradle 8.7: `C:/toneai-tools/gradle-8.7`
  - Android SDK: `C:/toneai-tools/android` (platforms;android-34, build-tools;34.0.0, platform-tools)
- `toneai/android/local.properties` now EXISTS with `sdk.dir=C:\toneai-tools\android`.
- Gradle wrapper generated in `toneai/android/` (gradlew + gradlew.bat + wrapper jar, version 8.7).
- Gradle daemon quirk: first run downloads ~everything (10+ min); `tasklist`/`pgrep` can hang in this shell — poll build_log.txt files instead of process lists. `nohup … &` gets killed when the tool call times out; instead start builds with `(./gradlew … > log 2>&1 &)` subshell syntax, then poll the log in later calls.

---

## WHAT IS DONE ✅

### Backend (`toneai/backend/`) — COMPLETE, typecheck clean, 38/38 tests pass ✅
- Full Fastify REST API: auth (register/login/refresh-rotation/logout/logout-all/me/delete-me), Instagram accounts (mock connect + real OAuth + disconnect + sync + delete), conversations (list/detail/messages/generate/regenerate/rewrite/send/settings), memories (get/put/delete), tone profile (get/put/reset), style examples (CRUD + reset), settings/usage, privacy endpoints, automation rules CRUD, webhook (GET verify + POST HMAC-checked), diagnostics, /health.
- Provider abstractions: AIProvider (mock + OpenAI), MessagingProvider/InstagramProvider (mock + Graph API), NotificationProvider (noop + FCM stub).
- Migrations 001/002, guardrails (sensitive never auto-sent, quota checks, ownership checks everywhere).

**Day 2 fixes (all verified):**
1. `src/auth/guard.ts` — `requireAuth()` now returns `AuthContext` (was returning the whole request; 100+ `.userId` errors). Throws 401-tagged error if guard missing.
2. `src/ai/index.ts` — added `export const aiProvider = createAIProvider()` (server/diagnostics/service import it).
3. `src/server.ts` — `trustedProxies` → `trustProxy` (correct Fastify 4 name; also fixed Http2 overload confusion).
4. `src/instagram/webhook.ts` — added `declare module "fastify" { interface FastifyContextConfig { rawBody?: boolean } }`.
5. `src/conversations/service.ts` — added explicit generic type to `getOwnedAccount` query (QueryResultRow variance error).
6. `src/ai/mockProvider.ts` — TWO real bugs found by tests:
   - Classifier: added `DIRECT_QUESTION` regex checked BEFORE invitation check, so "are you coming tonight?" → question while "party… coming?" stays invitation.
   - Professional mode: final `capitalization === "lowercase"` pass was lowercasing after professional capitalization → now `&& mode !== "professional"`.
- `npx tsc -p tsconfig.json --noEmit` → **0 errors**. `npm test` → **38 passed (4 files)**.

### Android app (`toneai/android/`) — ALL SOURCE CODE WRITTEN ✅ (build fix in progress)
Gradle files: `settings.gradle.kts` (repos + :app), root `build.gradle.kts` (AGP 8.2.2, Kotlin 1.9.24, serialization plugin, KSP 1.9.24-1.0.20), `gradle.properties` (**`ksp.incremental=false` added as last action — see NEXT STEPS**), `app/build.gradle.kts` (compose BOM 2024.05.00, Retrofit 2.11 + kotlinx-serialization converter, Room 2.6.1 + KSP, DataStore, security-crypto, WorkManager, navigation-compose, BuildConfig.API_BASE_URL=http://10.0.2.2:3000/), `proguard-rules.pro`, `local.properties`.
Manifest: `.ToneAIApp` + `.MainActivity`, INTERNET + POST_NOTIFICATIONS, exported MainActivity.
Res: strings.xml, themes.xml (Theme.ToneAI), adaptive launcher icon (mipmap-anydpi-v26 + 2 vector drawables).

**Kotlin source (20 files, all compile-ready but NOT yet verified — one KSP failure to clear):**
- `ToneAIApp.kt` — Application class; manual DI: TokenManager, ApiModule(BuildConfig.API_BASE_URL), ToneRepository, ToneDatabase.
- `MainActivity.kt` — session splash (AppViewModel: Loading/LoggedOut/LoggedIn restored from tokens) → AuthFlow (login/register NavHost) → MainFlow (home → inbox → conversation, settings, tone, style). Logout calls repo.logout() then flips session.
- `data/local/TokenManager.kt` — DataStore (access/refresh/userId).
- `data/local/CacheDb.kt` — Room: ConversationEntity/MessageEntity + DAOs (observe/upsert/markHasDraft), ToneDatabase singleton.
- `data/remote/Dto.kt` — ALL API DTOs matching backend shapes exactly (checked against routes): auth, accounts, conversations, messages, drafts, memory, tone profile, style examples, settings, usage, rules, diagnostics, errors.
- `data/remote/ToneApi.kt` — Retrofit interface: every backend endpoint.
- `data/remote/ApiModule.kt` — OkHttp with Bearer interceptor + single 401→refresh→retry interceptor (raw /auth/refresh call), Json {ignoreUnknownKeys, explicitNulls=false, encodeDefaults=false}, ApiException(code) with isAuthError/isQuota, throwableMessage() (IOException → "Network unavailable — showing cached data").
- `data/repo/ToneRepository.kt` — auth save/clear tokens, accounts, conversations cache-first (observeX + refreshX), generate/regenerate/rewrite/send (send = explicit approval only, refreshes messages on ok), memory, `apiService` passthrough for settings/tone screens.
- `ui/AppViewModel.kt` — SessionState (Loading/LoggedOut/LoggedIn).
- `ui/VmFactory.kt` — ToneVmFactory mapping all 6 ViewModels; `toneVmFactory(context)` helper.
- `ui/theme/Theme.kt` + `Type.kt` — M3 dark/light + dynamic color.
- `ui/common/Common.kt` — LoadingView, ErrorView(retry), OfflineBanner (exact text: "Offline — showing cached data. Messages are not sent until the server confirms."), QuickChipsRow.
- `ui/screens/AuthScreens.kt` — Login + Register + AuthViewModel (fixed: rememberSaveable fields, validation, loading/error states).
- `ui/screens/HomeScreens.kt` — HomeScreen (accounts list, MOCK badge, connect-demo flow POST /instagram/connect {provider:"mock"}, disconnect) + InboxScreen (offline-first via Room flow, sync button, AI-draft badge, unread badge) + HomeViewModel/InboxViewModel.
- `ui/screens/ConversationScreen.kt` — message bubbles, AI draft Card (badge + "AI drafts require your approval" note + SENSITIVE warning when draft.sensitive), editable draft, quick chips SHORTER/FUNNIER/CASUAL/MATCH TONE (rewrite actions), custom instruction + Apply, Regenerate, Approve & send (computes edited=original≠current, calls sendApproved). ConversationViewModel.
- `ui/screens/ToneScreens.kt` — ToneProfileScreen (formality/emoji/humor sliders, learning toggle, save) + StyleExamplesScreen (add/delete list). ToneProfileViewModel/StyleExamplesViewModel.
- `ui/screens/SettingsScreens.kt` — SettingsScreen with sections: Notifications (mode/newDm/FCM status), Usage (today+month vs limits), Privacy (delete conversations/memories/style-examples, reset tone, disable learning/memory), Security (approval + sensitive + OAuth-only notes), Developer diagnostics (GET /diagnostics), logout. SettingsViewModel.
- Tests: `app/src/test/java/com/toneai/app/DraftLogicTest.kt` (6 tests: edited detection, never-send-without-approval, sensitive-unedited-blocked, sensitive-edited-allowed, blank-never-sends), `SessionStateTest.kt`.

**Key behaviors honored:** AI-draft badge in inbox + conversation, SEND/EDIT/REGENERATE + quick chips, mock-connection flow, never store IG passwords, offline banner + Room cache, approval gating mirrors backend sensitive guardrail.

### Docs — NOT STARTED ❌ (see NEXT STEPS)

---

## LAST BUILD STATE (exact)

**Day 3: ✅ `./gradlew assembleDebug` BUILD SUCCESSFUL in 3m14s (38 tasks).**
**APK: `toneai/android/app/build/outputs/apk/debug/app-debug.apk` (18,525,098 bytes / ~18.5 MB, built 14:25).**

Errors fixed this session:
1. KSP Windows incremental bug (`NoSuchFileException ...generated\ksp\debug\java`) → `ksp.incremental=false` in gradle.properties ✅ VERIFIED.
2. `Theme.kt:69` recursive type error (`object ToneColors { val VioletDark = VioletDark }` self-shadow) → explicit type + direct value ✅ VERIFIED.

Done after APK:
- ✅ `./gradlew testDebugUnitTest` BUILD SUCCESSFUL in 48s — **7/7 tests pass** (DraftLogicTest 6/6, SessionStateTest 1/1). Results XML in `app/build/test-results/testDebugUnitTest/`.
- ✅ `./gradlew assembleRelease` BUILD SUCCESSFUL in 8m36s (48 tasks) — **`app/build/outputs/apk/release/app-release-unsigned.apk` (12,634,689 bytes / ~12.6 MB, built 14:38)**. Unsigned (no signing config — expected; lintVital passed).
- → NEXT: docs (README, .env.example, docker-compose.yml, docs/META_SETUP.md) → secrets scan → final report.

### Docs progress
- ✅ `toneai/.env.example` — matches src/config/env.ts exactly (read it to confirm names).
- ✅ `toneai/docker-compose.yml` — postgres:16 + redis:7 + backend, healthchecks, required JWT secrets.
- ✅ `toneai/backend/Dockerfile` — node:20-alpine, tsc build in image.
- ✅ `toneai/docs/META_SETUP.md` — business account prereqs, app creation, OAuth redirect config, scopes, app review, webhook verify + X-Hub-Signature-256, troubleshooting table, mock-mode instructions.
- ✅ `toneai/README.md` — architecture diagram, quick starts (backend + Android), API surface, security model, known limitations (unsigned release, FCM stub, Redis unused, mock AI quality), future improvements.
- → NEXT: secrets scan → verify ownership checks → final report in required format.

### Secrets scan & verification (all CLEAN ✅)
- API-key/secret regex scan over backend/src, backend/tests, android/app/src, scripts, compose, docs → **0 hits** (only dev-only `change-me` fallbacks in env.ts, which are documented dev defaults).
- No Instagram password anywhere — the only "password" mentions are comments saying passwords are never handled (provider.ts, oauth.ts, TokenManager.kt).
- `.gitignore` covers .env, build/, local.properties, node_modules, dist; no `backend/.env` file exists.
- Ownership checks spot-audit: conversations/service.ts 6 user_id-scoped queries, settingsRoutes.ts 5, tone/routes.ts 1 (+ guard-based auth on all routes).

### Final re-verification (Day 3, all green ✅)
- Backend `tsc --noEmit`: 0 errors. Backend tests: 38/38 (4 files).
- Android: `app-debug.apk` 18,525,098 bytes; `app-release-unsigned.apk` 12,634,689 bytes.

## ✅ PROJECT COMPLETE — write the FINAL REPORT next (see format below), nothing else pending.

Final report format: BUILD STATUS / APK PATH / BACKEND STATUS / TEST STATUS / INSTAGRAM INTEGRATION STATUS / AI STATUS / REMAINING CONFIGURATION / KNOWN LIMITATIONS / NEXT STEPS.

---

# DAY 3 ADD-ON (user request): IG export import → tone learning + APK to D:/ + push to GitHub

User asks: (1) drop Instagram downloaded chat data (the official "Download your information" JSON export) into the app and ToneAI learns the user's tone from it; (2) APK placed directly in `D:/`; (3) push everything to a NEW GitHub repo using gh CLI found "on tools folder".

Setup discovered:
- No git repo exists at `D:/vs code projects` or `toneai/` — need `git init` inside `toneai/`.
- gh CLI was NOT installed → downloaded gh 2.62.0 zip to `/c/toneai-tools/` (user's tools folder) and extracted to **`C:/toneai-tools/bin/gh.exe`** (zip had `bin/gh.exe` at root). `gh --version` OK.
- `gh auth status` → **already logged in as gautamkr0104**, scopes include `repo`. No git user.name/email configured → must set repo-local config before committing.

## Plan (do in order, update this file after EACH step)
1. ✅ gh CLI installed at C:/toneai-tools/bin/gh.exe + auth verified.
2. ✅ Backend import feature DONE:
   - `src/tone/importChats.ts` — parser for IG "Download your information" message_N.json (single object OR array of chunks, newest-first normalization, geoblocked/non-text skip, latin-1 mojibake repair via TextDecoder used only when it strictly reduces mojibake markers), `pickMyName` (account hint → else most-active sender), `computeToneStats` (avg length, emoji frequency + top-8 emojis, lowercase/standard detection, formality, hinglish usage via HINGLISH_WORDS vs ENGLISH_WORDS, languages, top slang, asksFollowups), `importChatsForUser` (sensitive messages skipped via SENSITIVE_HINTS, ≥10 msgs required, tone_profiles upsert, ≤400 deduped style_examples source='ig_import' with embeddings, audit event).
   - `src/tone/routes.ts` — `POST /tone/import-chats` (bodyLimit 32MB, accepts {json, accountHint?, igAccountId?} or raw payload) + `GET /tone/import-chats/status`.
   - `tests/importChats.test.ts` — 8 tests (parse shapes, mojibake, tone stats, owner picking).
   - **46/46 tests pass, tsc clean.** Note: mojibake repair intentionally only fires on double-misencoded text (single "Ã" is ambiguous); see test for the exact expectation.
3. → Android import UI (file picker in ToneProfileScreen) + Dto/API additions.

## DAY 3 ADD-ON #2 (user request): TURBO MODE — send AI replies without prior approval

User wants an antigravity-agent-style "turbo" mode: AI sends without asking first. Design decision (told user): sensitive content (money/health/legal/threats) is STILL held as a draft even in turbo — that guardrail protects their account from autonomously sending harmful messages; everything else can auto-send.

**Backend DONE ✅ (48/48 tests, tsc clean):**
- `db/migrations/003_turbo.sql` — `user_automation_settings (user_id PK, turbo_mode, turbo_acknowledged_at, updated_at)`.
- `src/automation/turbo.ts` — `getTurbo`/`setTurbo` (enabling REQUIRES literal ack string `I_UNDERSTAND`, recorded in DB + audit; disabling needs no ack) + `isTurboOn` fast check.
- `src/conversations/service.ts` — `generateDraft` now: after generating, if `conv.auto_reply_mode === 'automatic'` AND `isTurboOn(userId)` → `evaluateAutoReply` (hard guardrails: unknown sender / sensitive / unknown-facts never auto) → `sendApprovedMessage` (re-classifies + blocks unedited sensitive) → `autoSent` flag in response + notification "Turbo reply sent". `GeneratedDraft.autoSent` added; rewriteDraft returns `autoSent: false`.
- `src/users/settingsRoutes.ts` — `GET /automation/turbo`, `PUT /automation/turbo {enabled, acknowledgement?}` (400 `acknowledgement_required` without exact ack).
- `tests/turbo.test.ts` — ack contract tests (2).

**Android turbo + import UI DONE ✅:**
- `Dto.kt` — TurboSettingsDto/TurboResponse/TurboUpdateRequest + ImportChatsRequest(json: JsonElement, accountHint, igAccountId)/ImportChatsResponse/ToneStatsDto/ImportStatusResponse.
- `ToneApi.kt` — importChats, importStatus, turbo, setTurbo.
- `ToneRepository.kt` — importChats(json, accountHint), importStatus().
- `ToneScreens.kt` — ImportChatsCard (OpenDocument file picker application/json, reads file on Dispatchers.IO, parses with kotlinx JsonElement, uploads, shows learned stats: msg counts, avg chars, emoji %, capitalization, languages, slang, saved examples) + added to ToneProfileScreen. ImportChatsViewModel.
- `SettingsScreens.kt` — Turbo section in SettingsScreen: Switch (ON → TurboConfirmDialog explaining auto-send + what stays protected; OFF → direct), setTurbo sends acknowledgement "I_UNDERSTAND". SettingsViewModel extended with turbo state.
- `ConversationScreen.kt` — "TURBO — already sent" badge when draft.autoSent.
- Backend re-verified: 48/48 tests, tsc clean.

**→ NEXT: rebuild assembleDebug (expect first-compile errors in new code — iterate), copy APK to D:/ToneAI.apk, then git init + gh repo create + push.**

### Build round 3 (new features) status
- Round 3a: 4 compile errors → FIXED:
  1. `Dto.kt` DraftDto missing `autoSent` (backend sends it; ignoreUnknownKeys would have made it default false anyway, but UI reads it) → added `val autoSent: Boolean = false`.
  2-4. `ToneScreens.kt` — `Json.parse(...)` doesn't exist in kotlinx-serialization 1.6.3 + type mismatch in withContext → replaced with `Json.parseToJsonElement(text)` (JsonElement is the target type directly).
- Round 3b: KSP hung >20 min (daemons deadlocked after abrupt session kill). RECOVERY USED: `./gradlew --stop` + `taskkill //F //IM java.exe` + `rm -rf app/build/kotlinC app/build/generated/ksp .kotlin` + rebuild `--no-daemon`.
- ✅ Round 3c: **BUILD SUCCESSFUL in 4m26s.**
- ✅ **APK copied to `D:/ToneAI.apk` (18,661,056 bytes, built 15:45, includes IG chat import + Turbo mode).**

→ NEXT: git init in toneai/ + repo-local git identity + gh repo create + push.

### GitHub push DONE ✅
- `git init` in toneai/ + repo-local identity (gautamkr0104 / noreply email) + `git config --global --add safe.directory 'D:/vs code projects/toneai'` (dubious-ownership fix).
- .gitignore extended: build_log*.txt, test_log.txt, release_log.txt, build_pid.txt excluded (were staged, removed).
- Commit `cfa6d5d` — 90 files: full backend + android + docs + migrations + tests.
- `gh repo create ToneAI --private --source . --push` → **https://github.com/gautamkr0104/ToneAI** (PRIVATE, branch master, commit verified via API).
- gh CLI lives at `C:/toneai-tools/bin/gh.exe` (user's tools folder as requested).

## ✅ DAY 3 ADD-ONS COMPLETE — ALL USER REQUESTS SHIPPED
1. ✅ IG chat drop-in import → tone learning (backend parser + Android file picker UI).
2. ✅ APK at **`D:/ToneAI.apk`** (18,661,056 bytes, debug-signed, installable).
3. ✅ Turbo mode (AI sends without prior approval, ack-gated, guardrails kept).
4. ✅ Pushed to https://github.com/gautamkr0104/ToneAI — now **PUBLIC** (was created private, user approved the visibility change).

**CORRECTION (user feedback):** gh CLI was already at **`D:/tools/gh/bin/gh.exe`** (v2.97.0, logged in as gautamkr0104) — I failed to check D:/tools and had downloaded a duplicate to C:/toneai-tools/bin. Duplicate DELETED; all gh operations now/after use `D:/tools/gh/bin/gh.exe`. Repo existence + visibility verified with the user's gh binary.

Backend 48/48 tests. Android: DraftLogicTest 6 + SessionStateTest 1 (unit), assembleDebug + assembleRelease successful. To run end-to-end: start backend (`npm run dev` in backend/ — mock AI + mock IG by default), install D:/ToneAI.apk on phone/emulator, sign up, connect demo account, import IG export or chat normally.
4. Rebuild assembleDebug → copy APK to `D:/ToneAI.apk`.
5. git init in toneai/ (repo-local user config), .gitignore already good, gh repo create <name> --private --source . --push.
6. Final update to PROGRESS.md.

### Android build fix history (for reference if rebuilding)
- KSP: `ksp.incremental=false` (gradle.properties) — keep this.
- After weird KSP/daemon failures: `./gradlew --stop` + `rm -rf app/build/generated/ksp` before rebuild.

## NEXT STEPS (in order)

1. **Re-run build (verify KSP fix):**
   ```bash
   export JAVA_HOME=$(ls -d /c/toneai-tools/jdk-17* | head -1)
   export ANDROID_HOME=/c/toneai-tools/android
   cd toneai/android && ./gradlew --stop   # clear possibly-poisoned daemon state
   (./gradlew assembleDebug > build_log2.txt 2>&1 &)
   # then poll: tail -c 2000 build_log2.txt   (takes ~5-10 min first compile)
   ```
2. Fix any REAL Kotlin compile errors (first actual compile of all 20 files — expect a handful; likely suspects: imports in ConversationScreen (KeyboardType import unused, androidx.lifecycle.viewmodel.compose.viewModel reference style), InboxScreen `conversations` unused-property leftover in InboxViewModel (`val conversations = emptyFlow` — delete it), VmFactory referencing screens' ViewModels (all exist), SettingsScreens SettingsViewModelData private class usage).
3. `./gradlew testDebugUnitTest` → expect 7 tests pass (DraftLogicTest 6 + SessionStateTest 1).
4. `./gradlew assembleRelease` (unsigned OK) after debug succeeds.
5. Verify APK exists: `app/build/outputs/apk/debug/app-debug.apk`.
6. Write docs: `toneai/README.md` (setup, env vars, Meta config, backend startup, APK install, known limitations, future improvements), `toneai/.env.example`, `toneai/docker-compose.yml` (postgres+redis+backend), `toneai/docs/META_SETUP.md` (Meta app review, business account, permissions instagram_business_login/messaging, webhook setup).
7. Secrets scan: `grep -rEn "sk-[a-zA-Z0-9]{10,}|api[_-]?key\s*=\s*['\"][a-zA-Z0-9]{10,}" toneai --include="*.ts" --include="*.kt" --include="*.env*"` → expect nothing; verify no IG password anywhere; verify ownership checks present.
8. Optional: `scripts/seed_demo.py` needs `pip install asyncpg` + running Postgres (no Docker on this machine) — document as optional.
9. Final report in required format: BUILD STATUS / APK PATH / BACKEND STATUS / TEST STATUS / INSTAGRAM INTEGRATION STATUS / AI STATUS / REMAINING CONFIGURATION / KNOWN LIMITATIONS / NEXT STEPS.

## KEY COMMANDS

```bash
# backend
cd toneai/backend && npx tsc -p tsconfig.json --noEmit && npm test

# android build
export JAVA_HOME=$(ls -d /c/toneai-tools/jdk-17* | head -1)
export ANDROID_HOME=/c/toneai-tools/android
cd toneai/android && ./gradlew --stop && (./gradlew assembleDebug > build_log2.txt 2>&1 &)
# poll with: tail -c 2000 build_log2.txt
```

## GOTCHAS (Days 1+2)

- Tool write_file calls intermittently drop the `instructions` (or `path`) param → error "Invalid input: expected string, received undefined". Just retry the exact same call; it works.
- No BACKGROUND process mode; `nohup cmd &` gets killed when the tool call times out. Use `(cmd > log 2>&1 &)` — the subshell detaches and survives; then poll the log in separate calls. `tasklist`/`pgrep` can hang the shell; don't use them.
- `npx tsx -e "…"` inline scripts got mangled (npm notice flood, empty output) — write a temp .ts file and run `npx tsx file.ts` instead; delete after.
- Long Gradle first-build exceeds even a 600s SYNC call — always background + poll pattern.
- KSP on Windows: incremental mode bug → `ksp.incremental=false` (already set).
- esbuild postinstall scripts blocked by npm allowScripts policy — tsx/vitest still worked fine (verified Day 2).
- Backend tests are DB-free by design; live-DB integration test needs Postgres (no Docker here) — skip or document.
- Windows: bash + POSIX syntax, forward slashes, `tar.exe -xf` for unzipping.
