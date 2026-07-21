import { encryptProviderToken } from "../../../../lib/security/aes-gcm";
import { requireDevice } from "../../../../lib/security/device-auth";
import { ApiError } from "../../../../lib/security/errors";
import { hashPushToken } from "../../../../lib/security/hash";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { recordAuditEvent } from "../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

const FCM_FID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export async function POST(request: Request) {
  try {
    const { device } = await requireDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const fcmInstallationId =
      typeof body?.fcmInstallationId === "string" ? body.fcmInstallationId.trim() : "";
    if (!FCM_FID_PATTERN.test(fcmInstallationId) || body?.pushProvider !== "fcm_fid") {
      throw new ApiError("invalid_push_registration", "Push registration is invalid.", 400);
    }
    const installationId = typeof body?.installationId === "string" ? body.installationId.trim() : "";
    if (device.installation_id && installationId !== device.installation_id) {
      throw new ApiError("device_auth_failed", "Device authentication failed.", 401);
    }
    const pushVault = await encryptProviderToken(fcmInstallationId, {
      userId: device.user_id,
      provider: "whatsapp",
      connectionId: device.id,
    });
    const now = new Date().toISOString();
    await supabaseRest<unknown>(
      `/rest/v1/devices?id=eq.${postgrestValue(device.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          push_provider: "fcm_fid",
          push_token_hash: await hashPushToken(fcmInstallationId),
          push_token_vault: pushVault,
          last_seen_at: now,
        },
      },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: device.user_id,
      actorType: "device",
      actorId: device.id,
      eventType: "mobile_push_registration_saved",
      deviceId: device.id,
      metadata: { provider: "fcm_fid" },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return noStoreJson({ ok: true, registeredAt: now });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
