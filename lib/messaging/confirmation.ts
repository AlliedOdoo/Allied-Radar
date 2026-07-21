import { MessagingError, type OutboundMessage } from "./types";
import { postgrestValue, supabaseRest } from "../supabase/rest";

type ConfirmationPayload = {
  version: 2;
  userId: string;
  provider: OutboundMessage["provider"];
  requestId: string;
  contentHash: string;
  destinationHash: string;
  nonce: string;
  expiresAt: number;
};

const TOKEN_LIFETIME_MS = 2 * 60 * 1000;

function secret() {
  const value = process.env.SEND_CONFIRMATION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new MessagingError(
      "confirmation_not_configured",
      "The send confirmation secret must be at least 32 characters",
      503,
    );
  }
  return value;
}

export function isConfirmationConfigured() {
  return (process.env.SEND_CONFIRMATION_SECRET?.trim().length ?? 0) >= 32;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function messageFingerprints(message: OutboundMessage) {
  return {
    contentHash: await digest(
      JSON.stringify({
        content: message.content,
        subject: message.subject ?? "",
        replyToId: message.replyToId ?? "",
        replyMode: message.replyMode ?? "",
        cc: message.cc ?? [],
        bcc: message.bcc ?? [],
        internetMessageHeaders: message.internetMessageHeaders ?? [],
        attachments: (message.attachments ?? []).map((attachment) => ({
          name: attachment.name,
          contentType: attachment.contentType,
          size: attachment.size,
          contentBytesHash: attachment.contentBytes,
        })),
      }),
    ),
    destinationHash: await digest(
      JSON.stringify({
        provider: message.provider,
        destination: message.destination,
        destinationLabel: message.destinationLabel,
      }),
    ),
  };
}

export async function createConfirmationToken(message: OutboundMessage, userId: string) {
  const fingerprints = await messageFingerprints(message);
  const payload: ConfirmationPayload = {
    version: 2,
    userId,
    provider: message.provider,
    requestId: message.clientRequestId,
    ...fingerprints,
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(encodedPayload),
  );

  await supabaseRest<unknown>(
    "/rest/v1/send_confirmations",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        id: payload.nonce,
        user_id: userId,
        provider: message.provider,
        client_request_id: message.clientRequestId,
        content_hash: payload.contentHash,
        destination_hash: payload.destinationHash,
        expires_at: new Date(payload.expiresAt).toISOString(),
      },
    },
    { serviceRole: true },
  );

  return {
    token: `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: payload.expiresAt,
  };
}

export async function consumeConfirmationToken(
  message: OutboundMessage,
  token: string | undefined,
  userId: string,
) {
  if (!token) {
    throw new MessagingError(
      "confirmation_token_required",
      "This review has expired. Review the message again before sending.",
      409,
    );
  }

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new MessagingError(
      "invalid_confirmation_token",
      "This review is invalid. Review the message again.",
      409,
    );
  }

  const signatureValid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(encodedPayload),
  );
  if (!signatureValid) {
    throw new MessagingError(
      "invalid_confirmation_token",
      "The message changed after review. Review it again before sending.",
      409,
    );
  }

  let payload: ConfirmationPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as ConfirmationPayload;
  } catch {
    throw new MessagingError(
      "invalid_confirmation_token",
      "This review is invalid. Review the message again.",
      409,
    );
  }

  const now = Date.now();
  if (payload.expiresAt <= now) {
    throw new MessagingError(
      "confirmation_expired",
      "This review expired. Review the message again before sending.",
      409,
    );
  }
  const fingerprints = await messageFingerprints(message);
  if (
    payload.version !== 2 ||
    payload.userId !== userId ||
    payload.provider !== message.provider ||
    payload.requestId !== message.clientRequestId ||
    payload.contentHash !== fingerprints.contentHash ||
    payload.destinationHash !== fingerprints.destinationHash
  ) {
    throw new MessagingError(
      "confirmation_mismatch",
      "The recipient or message changed after review. Review it again.",
      409,
    );
  }

  const consumedAt = new Date(now).toISOString();
  const consumed = await supabaseRest<Array<{ id: string }>>(
    `/rest/v1/send_confirmations?id=eq.${postgrestValue(payload.nonce)}&user_id=eq.${postgrestValue(userId)}&provider=eq.${postgrestValue(message.provider)}&client_request_id=eq.${postgrestValue(message.clientRequestId)}&content_hash=eq.${postgrestValue(fingerprints.contentHash)}&destination_hash=eq.${postgrestValue(fingerprints.destinationHash)}&consumed_at=is.null&expires_at=gt.${postgrestValue(consumedAt)}&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { consumed_at: consumedAt },
    },
    { serviceRole: true },
  );
  if (consumed.length !== 1) {
    throw new MessagingError(
      "confirmation_already_used",
      "This confirmation was already used or expired. Review the message again.",
      409,
    );
  }
}
