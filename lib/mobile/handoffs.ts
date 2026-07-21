import {
  decryptProviderToken,
  encryptSensitiveValue,
  type EncryptedTokenEnvelope,
} from "../security/aes-gcm";
import { ApiError } from "../security/errors";
import { recordAuditEvent } from "../supabase/audit";
import { postgrestValue, supabaseRest } from "../supabase/rest";
import { isFcmConfigured, sendHandoffPush } from "./fcm";

type DeviceRow = {
  id: string;
  user_id: string;
  push_provider: string | null;
  push_token_vault: EncryptedTokenEnvelope | null;
};

type HandoffRow = { id: string; expires_at: string | null };

export type WhatsAppHandoff = {
  handoffId: string;
  expiresAt: string;
  pushQueued: boolean;
};

export async function createWhatsAppHandoff(input: {
  userId: string;
  recipientPhone: string;
  bodyText: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WhatsAppHandoff> {
  const recipientPhone = input.recipientPhone.replace(/[^0-9+]/g, "");
  const bodyText = input.bodyText.trim();
  if (!/^\+?[1-9][0-9]{6,14}$/.test(recipientPhone) || !bodyText || bodyText.length > 20_000) {
    throw new ApiError("invalid_handoff_request", "WhatsApp handoff is invalid.", 400);
  }

  const devices = await supabaseRest<DeviceRow[]>(
    `/rest/v1/devices?user_id=eq.${postgrestValue(input.userId)}&is_active=eq.true&push_provider=eq.fcm_fid&select=id,user_id,push_provider,push_token_vault&order=last_seen_at.desc.nullslast&limit=1`,
    { method: "GET" },
    { serviceRole: true },
  );
  const device = devices[0];
  if (!device?.push_token_vault) {
    throw new ApiError("no_paired_phone", "No paired Android phone is ready for handoff.", 409);
  }

  const encryptedPayload = await encryptSensitiveValue(
    JSON.stringify({ recipientPhone, bodyText }),
    { userId: input.userId, provider: "whatsapp", connectionId: device.id },
  );
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const rows = await supabaseRest<HandoffRow[]>(
    "/rest/v1/handoffs",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: input.userId,
        device_id: device.id,
        status: "pending",
        payload: { encrypted: encryptedPayload },
        expires_at: expiresAt,
      },
    },
    { serviceRole: true },
  );
  const handoff = rows[0];
  if (!handoff) {
    throw new ApiError("handoff_create_failed", "Phone handoff could not be created.", 502);
  }

  let pushQueued = false;
  if (isFcmConfigured()) {
    try {
      const fcmInstallationId = await decryptProviderToken(device.push_token_vault, {
        userId: input.userId,
        provider: "whatsapp",
        connectionId: device.id,
      });
      await sendHandoffPush(fcmInstallationId, handoff.id);
      pushQueued = true;
    } catch {
      pushQueued = false;
    }
  }

  await recordAuditEvent({
    userId: input.userId,
    actorType: "user",
    actorId: input.userId,
    eventType: pushQueued
      ? "whatsapp_handoff_queued"
      : "whatsapp_handoff_created_without_push",
    deviceId: device.id,
    metadata: { handoffId: handoff.id },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { handoffId: handoff.id, expiresAt, pushQueued };
}
