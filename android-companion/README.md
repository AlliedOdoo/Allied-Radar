# Allied Radar Android Companion

Standalone Kotlin Android scaffold for the Allied Radar WhatsApp bridge.

This project is intentionally separate from the web prototype. It captures WhatsApp notification metadata on-device, pairs with the Allied backend, uploads captures over HTTPS, and opens WhatsApp for user-reviewed outbound drafts. It never auto-sends messages.

## Scope

- Min Android: 8.0 / SDK 26
- UI: classic Android `Activity` views, no Compose
- Notification capture: `NotificationListenerService`
- Allowed packages only:
  - `com.whatsapp`
  - `com.whatsapp.w4b`
- Upload endpoint: `POST /api/mobile/notifications`
- Pairing endpoint: `POST /api/mobile/pairing/exchange`
- FCM registration endpoint: `POST /api/mobile/push-registration`
- Handoff fetch endpoint: `GET /api/mobile/handoffs/{handoffId}`
- Secret storage: Android Keystore-backed AES-GCM storage
- Backup policy: pairing data and tokens are excluded from Android cloud backup and device transfer
- Outbound: opens WhatsApp with prefilled text for human review; the user must tap Send in WhatsApp
- Firebase Messaging: accepts only opaque `handoff_id` payloads, shows a local notification, and opens review via `PendingIntent`

## Build

Expected local tooling:

- Android Studio Ladybug or newer, or compatible Android Gradle tooling
- JDK 17
- Android SDK platform 35 installed
- The included Gradle 8.9 wrapper

Open this folder as a standalone Android project:

```text
C:\tmp\unified-inbox\android-companion
```

## Backend contract

### Pairing exchange

`POST /api/mobile/pairing/exchange`

Request:

```json
{
  "pairingCode": "123456",
  "installationId": "local-generated-uuid",
  "platform": "android",
  "appVersion": "0.1.0"
}
```

Response:

```json
{
  "deviceToken": "opaque-device-bearer-token",
  "deviceId": "server-side-device-id"
}
```

`deviceToken` is stored with Android Keystore-backed encryption and is used only as:

```http
Authorization: Bearer <deviceToken>
```

### Notification upload

`POST /api/mobile/notifications`

Headers:

```http
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

Request:

```json
{
  "installationId": "local-generated-uuid",
  "sourcePackage": "com.whatsapp",
  "title": "Notification title",
  "text": "Notification text",
  "postedAt": 1720000000000,
  "capturedAt": 1720000000500,
  "notificationKey": "android-notification-key"
}
```

The service does not log notification title/text.

### FCM installation registration

`POST /api/mobile/push-registration`

Headers:

```http
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

Request:

```json
{
  "installationId": "local-generated-uuid",
  "platform": "android",
  "pushProvider": "fcm_fid",
  "fcmInstallationId": "opaque-firebase-installation-id"
}
```

The app uses Firebase's current Installation ID registration flow. It stores a newly received FCM installation ID with Android Keystore-backed encryption until it can register it. The ID is never logged.

### Handoff fetch

`GET /api/mobile/handoffs/{handoffId}`

Headers:

```http
Authorization: Bearer <deviceToken>
Accept: application/json
```

Response:

```json
{
  "handoffId": "opaque-server-issued-id",
  "recipientPhone": "+15551234567",
  "bodyText": "Server-provided draft text",
  "sourcePackage": "com.whatsapp"
}
```

The FCM payload must not contain the recipient or body. The app fetches those fields only after the user taps the local review notification.

## Firebase / `google-services.json`

No real Firebase config is included.

To enable Firebase Cloud Messaging:

1. Create a Firebase Android app with package name `com.allied.radar.bridge`.
2. Download the real `google-services.json`.
3. Place it at:

   ```text
   android-companion/app/google-services.json
   ```

4. Use `app/google-services.json.example` only as a shape reference.
5. Rebuild the app. The Google Services plugin and FCM service are enabled automatically only when the real file exists.

Without `google-services.json`, the app still builds and can capture WhatsApp notifications after pairing. Phone push for outbound draft handoffs remains disabled, and the Firebase service source and runtime components are left out of the APK until Firebase is configured.

FCM messages must be data-only and contain only an opaque handoff id:

```json
{
  "data": {
    "handoff_id": "opaque-server-issued-id"
  }
}
```

Do not include a Firebase `notification` payload, recipient, body, phone number, or preview text. The app deliberately ignores FCM messages containing a `notification` payload or data keys other than `handoff_id`.

When a valid `handoff_id` arrives, the app creates a local Android notification in the `Allied draft handoffs` channel. Tapping it opens the review screen using a `PendingIntent`; the Firebase service does not start activities directly from the background.

## Runtime setup

1. Install the companion app.
2. Enter the HTTPS Allied backend URL.
3. Enter the pairing code shown by the web app/backend.
4. Tap **Pair device**.
5. Tap **Open notification access settings** and enable Allied Radar Bridge.
6. Optionally grant Android 13+ notification permission for future review notifications.
7. Tap a handoff notification to fetch and review the server-provided destination/body.

## Outbound safety rule

The companion can open WhatsApp or WhatsApp Business with a prefilled draft using a `wa.me` URL only after it fetches the server-provided handoff over an authenticated request. It never receives recipient/body through FCM, never uses accessibility automation, never uses WhatsApp Web automation, and never performs hidden send actions. The user must review and tap Send inside WhatsApp.
