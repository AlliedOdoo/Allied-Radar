import { requireDevice } from "../../../../../lib/security/device-auth";
import { decryptSensitiveValue, type EncryptedTokenEnvelope } from "../../../../../lib/security/aes-gcm";
import { ApiError } from "../../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type HandoffRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  status: string;
  payload: Record<string, unknown>;
  expires_at: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { device } = await requireDevice(request);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new ApiError("invalid_handoff", "Handoff is invalid or expired.", 404);
    }
    const now = new Date().toISOString();
    const rows = await supabaseRest<HandoffRow[]>(
      `/rest/v1/handoffs?id=eq.${postgrestValue(id)}&device_id=eq.${postgrestValue(device.id)}&status=eq.pending&or=(expires_at.is.null,expires_at.gt.${postgrestValue(now)})&select=id,user_id,device_id,status,payload,expires_at&limit=1`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { status: "accepted", claimed_at: now },
      },
      { serviceRole: true },
    );
    const handoff = rows[0];
    if (!handoff || handoff.user_id !== device.user_id) {
      throw new ApiError("invalid_handoff", "Handoff is invalid or expired.", 404);
    }
    const envelope = handoff.payload.encrypted as EncryptedTokenEnvelope | undefined;
    if (!envelope) {
      throw new ApiError("invalid_handoff_payload", "Handoff is incomplete.", 409);
    }
    const decrypted = await decryptSensitiveValue(envelope, {
      userId: device.user_id,
      provider: "whatsapp",
      connectionId: device.id,
    });
    const payload = JSON.parse(decrypted) as Record<string, unknown>;
    const recipientPhone = typeof payload.recipientPhone === "string" ? payload.recipientPhone : "";
    const bodyText = typeof payload.bodyText === "string" ? payload.bodyText : "";
    if (!recipientPhone || !bodyText) {
      throw new ApiError("invalid_handoff_payload", "Handoff is incomplete.", 409);
    }

    await recordAuditEvent({
      userId: device.user_id,
      actorType: "device",
      actorId: device.id,
      eventType: "whatsapp_handoff_opened_on_phone",
      deviceId: device.id,
      metadata: { handoffId: handoff.id },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return noStoreJson({
      ok: true,
      handoffId: handoff.id,
      recipientPhone,
      bodyText,
      sourcePackage: "com.whatsapp",
      status: "opened_on_phone",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
