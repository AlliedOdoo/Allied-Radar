# Allied Radar architecture

Allied Radar is a human-controlled unified inbox for two Allied Fibreglass users.
The browser is the command centre; Cloudflare runs the application and API;
Supabase provides identity, PostgreSQL, row-level security, and realtime updates.

## Trust boundaries

- Authenticated AI requests may search, summarize, rank, and draft using only the
  selected bounded context. OpenRouter routing requires zero retention and denies
  provider data collection; requests fail closed when no compliant endpoint exists.
  AI never receives a delivery credential or invokes a provider send endpoint.
- Provider delivery happens only after the existing reviewed confirmation flow.
- `ENABLE_SEND_ACTIONS` remains `false` until every connector is tested with a
  non-production recipient.
- Browser-safe Supabase values may be exposed to the client. The service-role key,
  Microsoft secret, Odoo API key, encryption key, device token pepper, and FCM
  credentials remain server-only secrets.
- Microsoft provider tokens, Android FCM installation IDs, and WhatsApp handoff
  recipient/body payloads are encrypted with AES-GCM before storage. The Odoo API
  key remains a server-only secret.
- Android device tokens are random, stored only on the device, and represented in
  Supabase by a peppered SHA-256 digest.

## Incoming flow

1. Outlook and Teams are read through delegated Microsoft Graph access for the
   signed-in user.
2. Odoo Discuss is read using a least-privilege Odoo integration user, constrained
   to the server-side `ODOO_DISCUSS_CHANNEL_IDS` allowlist.
3. The Android companion observes only WhatsApp and WhatsApp Business notification
   packages after the user grants notification access.
4. Connectors normalize records into `messages`; Supabase RLS restricts every row
   to its owning user.
5. The desktop loads the user's normalized messages through an authenticated API.

## Outgoing flow

1. AI creates an editable draft.
2. The user reviews the exact recipient and full message.
3. The server verifies a short-lived confirmation token and atomically consumes its
   nonce in Supabase so it cannot be replayed across Cloudflare instances.
4. A durable `outbound_deliveries` authorization record is inserted before provider
   delivery begins.
5. Outlook, Teams, and Odoo use deterministic provider adapters. Odoo destinations
   must be in the configured Discuss channel allowlist.
6. WhatsApp creates an encrypted handoff through the same confirmed send endpoint.
   FCM carries only its opaque ID. The Android companion opens WhatsApp with recipient
   and text prefilled; the user presses Send in WhatsApp.
7. Audit state records authorization, `handed_off`, or provider acknowledgement. It
   never claims WhatsApp delivery when only a handoff occurred.

## Configuration phases

1. Scaffold and local contract tests: no live credentials required.
2. Supabase migration and Azure provider configuration.
3. Microsoft sign-in and read-only sync.
4. Odoo read-only sync.
5. Android pairing and notification ingestion.
6. Controlled outbound tests, one provider at a time.
7. Cloudflare deployment with server-only values stored as Secrets.
