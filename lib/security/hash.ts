import { requireEnv } from "./config";
import { bytesToBase64Url, utf8ToBytes } from "./encoding";
import { ApiError } from "./errors";

const DEVICE_TOKEN_MIN_LENGTH = 32;

async function hmacSha256(value: string, purpose: string) {
  const pepper = requireEnv("DEVICE_TOKEN_PEPPER", 32);
  const key = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    utf8ToBytes(`${purpose}\u0000${value}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hashDeviceToken(deviceToken: string) {
  const normalized = deviceToken.trim();
  if (normalized.length < DEVICE_TOKEN_MIN_LENGTH) {
    throw new ApiError("invalid_device_token", "Device authentication failed.", 401);
  }
  return hmacSha256(normalized, "allied-device-token-v1");
}

export async function hashPushToken(pushToken: string) {
  const normalized = pushToken.trim();
  if (!normalized) return null;
  return hmacSha256(normalized, "allied-push-token-v1");
}

export async function hashPairingCode(pairingCode: string) {
  const normalized = pairingCode.replace(/\s+/g, "").toUpperCase();
  if (normalized.length < 8) {
    throw new ApiError("invalid_pairing_code", "Pairing code is invalid or expired.", 404);
  }
  return hmacSha256(normalized, "allied-pairing-code-v1");
}

export async function hashAuditValue(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return hmacSha256(normalized, "allied-audit-value-v1");
}
