import { requireEnv } from "./config";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToUtf8,
  keyMaterialFromBase64,
  utf8ToBytes,
} from "./encoding";
import { ApiError } from "./errors";

const KEY_ENV = "PROVIDER_TOKEN_ENCRYPTION_KEY";
const KEY_ID_ENV = "PROVIDER_TOKEN_ENCRYPTION_KEY_ID";
const DEFAULT_KEY_ID = "provider-token-v1";

export type TokenEncryptionContext = {
  userId: string;
  provider: "outlook" | "teams" | "odoo_discuss" | "whatsapp";
  connectionId?: string;
};

export type EncryptedTokenEnvelope = {
  v: 1;
  alg: "AES-GCM";
  kid: string;
  iv: string;
  ciphertext: string;
};

function additionalData(context: TokenEncryptionContext) {
  return utf8ToBytes(
    JSON.stringify({
      userId: context.userId,
      provider: context.provider,
      connectionId: context.connectionId ?? null,
    }),
  );
}

async function tokenKey() {
  const keyMaterial =
    process.env[KEY_ENV]?.trim() || process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!keyMaterial) requireEnv(KEY_ENV);
  const material = keyMaterialFromBase64(keyMaterial!, 32);
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSensitiveValue(
  value: string,
  context: TokenEncryptionContext,
): Promise<EncryptedTokenEnvelope> {
  if (!value) {
    throw new ApiError("empty_sensitive_value", "Sensitive value is empty.", 400);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(context) },
    await tokenKey(),
    utf8ToBytes(value),
  );

  return {
    v: 1,
    alg: "AES-GCM",
    kid: process.env[KEY_ID_ENV]?.trim() || DEFAULT_KEY_ID,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptSensitiveValue(
  envelope: EncryptedTokenEnvelope,
  context: TokenEncryptionContext,
) {
  if (
    envelope.v !== 1 ||
    envelope.alg !== "AES-GCM" ||
    !envelope.iv ||
    !envelope.ciphertext
  ) {
    throw new ApiError("invalid_provider_token_envelope", "Provider token cannot be decrypted.", 400);
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(envelope.iv),
      additionalData: additionalData(context),
    },
    await tokenKey(),
    base64UrlToBytes(envelope.ciphertext),
  );

  return bytesToUtf8(plaintext);
}

export function encryptProviderToken(token: string, context: TokenEncryptionContext) {
  return encryptSensitiveValue(token, context);
}

export function decryptProviderToken(
  envelope: EncryptedTokenEnvelope,
  context: TokenEncryptionContext,
) {
  return decryptSensitiveValue(envelope, context);
}
