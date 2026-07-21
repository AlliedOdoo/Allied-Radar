import { ApiError, ConfigurationError } from "../security/errors";
import { bytesToBase64Url, utf8ToBytes } from "../security/encoding";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function firebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  if (!projectId || !clientEmail || !privateKey) throw new ConfigurationError();
  return { projectId, clientEmail, privateKey };
}

export function isFcmConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID?.trim() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim(),
  );
}

function pemBytes(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!base64) throw new ConfigurationError();
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function serviceAccountAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const config = firebaseConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(utf8ToBytes(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = bytesToBase64Url(
    utf8ToBytes(
      JSON.stringify({
        iss: config.clientEmail,
        scope: FCM_SCOPE,
        aud: GOOGLE_TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8ToBytes(unsigned),
  );
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new ApiError("push_auth_failed", "Phone notification service is unavailable.", 502);
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.value;
}

export async function sendHandoffPush(fcmInstallationId: string, handoffId: string) {
  const config = firebaseConfig();
  const accessToken = await serviceAccountAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          fid: fcmInstallationId,
          data: { handoff_id: handoffId },
          android: { priority: "high", ttl: "600s" },
        },
      }),
    },
  );
  if (!response.ok) {
    throw new ApiError("push_delivery_failed", "Phone notification could not be queued.", 502);
  }
}
