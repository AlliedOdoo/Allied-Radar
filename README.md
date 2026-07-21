# Allied Radar

Allied Radar is a three-panel unified inbox for Outlook, Teams, Odoo Discuss, and WhatsApp. Kimi K2.6 through OpenRouter handles Copilot-style search assistance, summaries, and editable drafts when strict zero-retention/no-training routing is available. A separate authenticated connector layer handles outbound delivery only after an explicit final review.

## Run locally

```powershell
cd C:\tmp\unified-inbox
npm.cmd run dev
```

The local `.env.local` has already been created from the owner's setup document. It is ignored by Git and must never be copied into chat, screenshots, commits, or frontend code.

## Finish the live setup

1. In the Supabase SQL editor, run both files in `supabase/migrations` in timestamp order. The second migration adds durable send confirmations and outbound delivery records.
2. In Supabase Authentication > Sign In / Providers > Azure, enter the Microsoft application client ID and client secret, and set the Azure tenant URL for Allied Fibreglass.
3. In Microsoft Entra > App registrations > Allied Radar > API permissions, add delegated Microsoft Graph permissions: `User.Read`, `Mail.Read`, `Mail.Send`, `Chat.Read`, and `ChatMessage.Send`, then grant admin consent if the tenant requires it.
4. Add the Supabase service-role key to `.env.local`. This is server-only; do not use the publishable/anon key in its place.
5. Create an OpenRouter API key and save it as `OPENROUTER_API_KEY`, set `ENABLE_EXTERNAL_AI=true`, and set `AI_MODEL=moonshotai/kimi-k2.6`; the app only routes through providers that deny data collection and enforce zero retention. If no compliant endpoint is available, AI falls back to the private local assistant instead of leaking data.
6. Add a comma-separated allowlist of approved numeric Odoo Discuss channel IDs as `ODOO_DISCUSS_CHANNEL_IDS`. Odoo sync and sending remain unavailable without it.
7. Use Connections in the app to sign in to Microsoft, sync Microsoft/Odoo, and create an Android pairing code.
8. Install the Firebase-free companion APK for WhatsApp notification ingestion. To enable outbound phone handoff notifications, add Firebase server credentials plus Android `google-services.json`, then rebuild the push-enabled APK.

The Azure redirect URL is the Supabase callback, not the app callback:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

## Enable sending

Sending fails closed by default. Configure at least one connector, set a random confirmation secret of 32+ characters, then enable the master switch in `.env.local`:

```text
ENABLE_SEND_ACTIONS=true
SEND_CONFIRMATION_SECRET=replace-with-a-long-random-secret
```

Provider requirements:

- Outlook: delegated Microsoft Graph access with `Mail.Read` and `Mail.Send`.
- Teams: delegated work-account Graph access with `Chat.Read` and `ChatMessage.Send`; the destination must be an existing chat ID.
- Odoo Discuss: URL, database, dedicated least-privilege username, API key, and `ODOO_DISCUSS_CHANNEL_IDS`. Sync and sending are restricted to those channels and default to `discuss.channel`.
- WhatsApp personal: reviewed handoff to `wa.me`; Allied fills the recipient and text, then you press Send in WhatsApp. There is no supported direct-send API for personal WhatsApp accounts.

Microsoft provider tokens, Android FCM installation IDs, and WhatsApp handoff recipient/body payloads are encrypted with AES-GCM before they are stored in Supabase. Odoo and Firebase credentials remain server-only environment secrets. FCM receives only an opaque handoff ID.

## Safety boundary

- AI routes require an authenticated Supabase user, accept bounded selected context, and enforce OpenRouter zero-retention/no-collection routing.
- The confirmation and send routes both require an authenticated Supabase user and fresh user-intent headers.
- A short-lived signed confirmation token is bound to the authenticated user, exact provider, destination, message, and request ID. Consumption is an atomic Supabase update, so it remains one-use across Cloudflare instances.
- Every outbound attempt creates a durable `outbound_deliveries` record before any provider is invoked.
- WhatsApp handoffs can only be created inside the confirmed send route; the old direct handoff endpoint is disabled.
- The UI always shows a final recipient and message review.
- Failed sends are never retried automatically.
- `ENABLE_SEND_ACTIONS=false` is a master kill switch.

Provider sync/mobile events are written to `audit_events`; security-critical outbound authorization and result state are recorded separately in `outbound_deliveries`.

## Validate

```powershell
npm.cmd test
```
