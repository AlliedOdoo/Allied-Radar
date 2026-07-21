import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../supabase/migrations/20260717123000_backend_auth_scaffold.sql", import.meta.url);
const hardeningMigration = new URL(
  "../supabase/migrations/20260720120000_security_hardening.sql",
  import.meta.url,
);

test("supabase migration creates required tables with RLS policies", async () => {
  const sql = await readFile(migration, "utf8");
  const tables = [
    "profiles",
    "connections",
    "messages",
    "devices",
    "pairing_codes",
    "handoffs",
    "audit_events",
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`${table}_[a-z_]+_own`, "i"));
  }

  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /token_vault jsonb/);
  assert.match(sql, /device_token_hash text not null/);
  assert.doesNotMatch(sql, /grant select \*|grant all on public\.connections to authenticated/i);
});

test("server auth validates bearer tokens through Supabase auth user endpoint", async () => {
  const source = await readFile(new URL("../lib/security/auth.ts", import.meta.url), "utf8");

  assert.match(source, /\/auth\/v1\/user/);
  assert.match(source, /authorization.*Bearer/);
  assert.match(source, /requireSupabaseAnonKey/);
  assert.doesNotMatch(source, /console\./);
});

test("Supabase REST supports modern secret keys without treating them as JWTs", async () => {
  const source = await readFile(new URL("../lib/supabase/rest.ts", import.meta.url), "utf8");

  assert.match(source, /startsWith\("sb_secret_"\)/);
  assert.match(source, /headers\.set\("apikey", key\)/);
  assert.match(source, /headers\.delete\("authorization"\)/);
  assert.match(source, /headers\.set\("authorization", `Bearer \$\{key\}`\)/);
  assert.match(source, /headers\.set\("authorization", `Bearer \$\{auth\.accessToken\}`\)/);
});

test("security helpers encrypt provider tokens and hash mobile secrets", async () => {
  const [cryptoSource, hashSource] = await Promise.all([
    readFile(new URL("../lib/security/aes-gcm.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/security/hash.ts", import.meta.url), "utf8"),
  ]);

  assert.match(cryptoSource, /AES-GCM/);
  assert.match(cryptoSource, /additionalData/);
  assert.match(cryptoSource, /PROVIDER_TOKEN_ENCRYPTION_KEY/);
  assert.match(hashSource, /DEVICE_TOKEN_PEPPER/);
  assert.match(hashSource, /HMAC/);
  assert.match(hashSource, /hashDeviceToken/);
  assert.doesNotMatch(`${cryptoSource}\n${hashSource}`, /console\./);
});

test("backend routes avoid secret logging and keep mobile ingestion device-authenticated", async () => {
  const files = [
    "../app/api/connectors/status/route.ts",
    "../app/api/mobile/pairing/start/route.ts",
    "../app/api/mobile/pairing/exchange/route.ts",
    "../app/api/mobile/notifications/route.ts",
  ];
  const sources = await Promise.all(
    files.map((file) => readFile(new URL(file, import.meta.url), "utf8")),
  );
  const combined = sources.join("\n");

  assert.match(combined, /requireDevice/);
  assert.match(combined, /hashDeviceToken/);
  assert.match(combined, /requireSupabaseUser/);
  assert.doesNotMatch(combined, /console\./);
  assert.doesNotMatch(combined, /deviceToken\s*:/);
});

test("phone push contains only an opaque handoff id", async () => {
  const source = await readFile(new URL("../lib/mobile/fcm.ts", import.meta.url), "utf8");
  assert.match(source, /data:\s*\{ handoff_id: handoffId \}/);
  assert.match(source, /fid:\s*fcmInstallationId/);
  assert.doesNotMatch(source, /token:\s*fcm/);
  assert.doesNotMatch(source, /recipientPhone|bodyText|message\.content/);
  assert.doesNotMatch(source, /console\./);
});

test("send confirmation is authenticated and bound to one user", async () => {
  const [confirmation, confirmRoute, sendRoute] = await Promise.all([
    readFile(new URL("../lib/messaging/confirmation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/send/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(confirmation, /userId/);
  assert.match(confirmation, /payload\.userId !== userId/);
  assert.match(confirmRoute, /requireSupabaseUser/);
  assert.match(sendRoute, /requireSupabaseUser/);
});

test("AI routes require authentication and fail closed to private routing", async () => {
  const [provider, draftRoute, searchRoute] = await Promise.all([
    readFile(new URL("../lib/ai/provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/draft/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/search/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(provider, /data_collection:\s*"deny"/);
  assert.match(provider, /zdr:\s*true/);
  assert.match(draftRoute, /requireSupabaseUser/);
  assert.match(searchRoute, /requireSupabaseUser/);
  assert.doesNotMatch(`${draftRoute}\n${searchRoute}`, /local placeholder/);
});

test("WhatsApp handoffs are confirmed server-side and encrypted at rest", async () => {
  const [disabledRoute, sendRoute, helper, deviceFetch] = await Promise.all([
    readFile(new URL("../app/api/mobile/handoffs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/send/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mobile/handoffs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/mobile/handoffs/[id]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(disabledRoute, /confirmed send endpoint/);
  assert.match(disabledRoute, /status:\s*405/);
  assert.match(sendRoute, /consumeConfirmationToken/);
  assert.match(sendRoute, /createWhatsAppHandoff/);
  assert.match(helper, /encryptSensitiveValue/);
  assert.match(helper, /payload:\s*\{ encrypted: encryptedPayload \}/);
  assert.match(deviceFetch, /decryptSensitiveValue/);
  assert.match(deviceFetch, /method:\s*"PATCH"/);
});

test("confirmation use and outbound audit state are durable in Supabase", async () => {
  const [sql, confirmation, sendRoute] = await Promise.all([
    readFile(hardeningMigration, "utf8"),
    readFile(new URL("../lib/messaging/confirmation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/send/route.ts", import.meta.url), "utf8"),
  ]);

  for (const table of ["send_confirmations", "outbound_deliveries"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`${table}_select_own`, "i"));
  }
  assert.match(confirmation, /\/rest\/v1\/send_confirmations/);
  assert.match(confirmation, /consumed_at=is\.null/);
  assert.doesNotMatch(confirmation, /new Map/);
  assert.match(sendRoute, /beginOutboundDelivery/);
  assert.match(sendRoute, /completeOutboundDelivery/);
});

test("Odoo sync and sending are restricted to approved Discuss channels", async () => {
  const [scope, syncRoute, providers] = await Promise.all([
    readFile(new URL("../lib/connectors/odoo.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/odoo/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/messaging/providers.ts", import.meta.url), "utf8"),
  ]);

  assert.match(scope, /ODOO_DISCUSS_CHANNEL_IDS/);
  assert.match(scope, /odoo_scope_not_configured/);
  assert.match(syncRoute, /\["model", "=", discussModel\]/);
  assert.match(syncRoute, /\["res_id", "in", channelIds\]/);
  assert.match(syncRoute, /\["message_type", "=", "comment"\]/);
  assert.match(providers, /channelIds\.includes\(channelId\)/);
});

test("Android companion is notification-only and never automates WhatsApp sending", async () => {
  const [manifest, listener, fcmService, launcher, reviewActivity, mainActivity] = await Promise.all([
    readFile(new URL("../android-companion/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../android-companion/app/src/main/java/com/allied/radar/bridge/NotificationBridgeService.kt",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../android-companion/app/src/firebase/java/com/allied/radar/bridge/FirebaseHandoffService.kt",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../android-companion/app/src/main/java/com/allied/radar/bridge/WhatsappLauncher.kt",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../android-companion/app/src/main/java/com/allied/radar/bridge/ReviewActivity.kt",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../android-companion/app/src/main/java/com/allied/radar/bridge/MainActivity.kt",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const androidSource = [manifest, listener, fcmService, launcher, reviewActivity, mainActivity].join("\n");

  assert.match(manifest, /BIND_NOTIFICATION_LISTENER_SERVICE/);
  assert.match(manifest, /android:name="\$\{firebaseServiceClass\}"/);
  assert.match(manifest, /android:enabled="\$\{firebaseEnabled\}"/);
  assert.match(listener, /setOf\("com\.whatsapp", "com\.whatsapp\.w4b"\)/);
  assert.match(fcmService, /message\.data\.keys != setOf\(KEY_HANDOFF_ID\)/);
  assert.match(fcmService, /message\.notification != null/);
  assert.match(fcmService, /override fun onRegistered\(installationId: String\)/);
  assert.match(manifest, /firebase_messaging_installation_id_enabled/);
  assert.match(launcher, /Intent\.ACTION_VIEW/);
  assert.match(launcher, /authority\("wa\.me"\)/);
  assert.match(reviewActivity, /tap Send manually/);
  assert.doesNotMatch(androidSource, /AccessibilityService|Intent\.ACTION_SEND|performClick|local-demo-handoff/);
});
