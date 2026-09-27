# Meta / Instagram Setup Guide

ToneAI connects to Instagram **only** through official Meta APIs. No scraping, no
reverse-engineered endpoints, no Accessibility Services, no Instagram passwords —
ever. Without Meta credentials the app runs fully in **mock mode** so you can
develop and demo everything safely.

## 1. Prerequisites

- An **Instagram Business** or **Creator** account (personal accounts are not
  supported by the official messaging APIs).
- A **Meta developer account** — https://developers.facebook.com.
- A **Facebook Page** linked to the Instagram account (required by Meta for
  messaging products).

## 2. Create the Meta app

1. Go to https://developers.facebook.com/apps → **Create App**.
2. Use case: **Manage everything on your Instagram account** (business type).
3. Add the products: **Instagram Graph API**, **Webhooks**.

## 3. Configure Instagram login

App settings → **Instagram** (or the Instagram product → **Basic settings**):

- Copy the **Instagram App ID** and **Instagram App Secret** → put them in
  `toneai/.env` as `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
- **Valid OAuth redirect URIs**: add `https://your-backend.example.com/instagram/oauth/callback`
  (this must equal `APP_BASE_URL` + `/instagram/oauth/callback` as configured on
  the backend).

The backend uses these scopes: `instagram_business_basic`,
`instagram_business_manage_messages`, `instagram_business_content_publish`
(scope list lives in `backend/src/instagram/oauth.ts`).

**App review:** until Meta approves your app in Live mode, only accounts with a
role in the app (Admin/Developer/Tester) can connect. For review, submit:

- Screencast showing the login + message-management flow.
- Justification for `instagram_business_manage_messages` (you reply to your own
  DMs with AI assistance; user approval required before any send).

## 4. Configure webhooks

The backend exposes `GET/POST /webhooks/instagram`.

1. Set `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in the backend `.env`.
2. App → **Webhooks** → object **Instagram**:
   - Callback URL: `https://your-backend.example.com/webhooks/instagram`
   - Verify token: same value as above → click **Verify and save**
     (this answers the GET `hub.challenge` handshake).
3. Subscribe to the **messages** field.

Signature validation: Meta sends `X-Hub-Signature-256`
(HMAC-SHA256 of the raw body with the App Secret). The backend validates it in
production when `INSTAGRAM_APP_SECRET` is set (`backend/src/instagram/webhook.ts`).

## 5. Production requirements

- **HTTPS** in front of the backend (Meta requires it for OAuth redirects and
  webhooks).
- Set `NODE_ENV=production`, strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
  (`openssl rand -hex 48`), and `FRONTEND_ORIGINS` to your app's origins.
- Envelope-encrypt the stored Instagram long-lived token with a KMS master key
  (currently stored as-is in `instagram_accounts.access_token_enc` — see
  `backend/src/instagram/routes.ts`).
- Meta app in **Live mode** after review.

## 6. Mock mode (no Meta account needed)

- Backend: leave `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` unset.
- App: Home → "Connect demo account" → `POST /instagram/connect {"provider":"mock","username":"..."}`
- Mock accounts are clearly labeled **MOCK** in the UI and use a deterministic
  mock provider with 4 seeded DM threads (see `backend/src/instagram/mockProvider.ts`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `instagram_not_configured` on connect | Backend missing `INSTAGRAM_APP_ID`/`SECRET` — mock mode still works. |
| OAuth redirect error `redirect_uri` mismatch | `APP_BASE_URL` on backend must exactly match the Meta "Valid OAuth redirect URIs" entry. |
| Webhook verification fails | Verify token mismatch; check GET handshake responds with `hub.challenge`. |
| 401 from Graph on sync | Long-lived token expired or permissions not approved — reconnect the account. |
