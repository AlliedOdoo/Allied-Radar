import { ApiError } from "../../../../../lib/security/errors";
import { hashDeviceToken, hashPairingCode } from "../../../../../lib/security/hash";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { randomBearerToken } from "../../../../../lib/security/device-auth";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type PairingRow = { id: string; user_id: string };
type DeviceRow = { id: string; user_id: string };

function required(body: Record<string, unknown>, key: string, max = 512) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("invalid_mobile_pairing_request", "Pairing request is invalid.", 400);
  }
  return value.trim().slice(0, max);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError("invalid_mobile_pairing_request", "Pairing request is invalid.", 400);

    const codeHash = await hashPairingCode(required(body, "pairingCode", 32));
    const installationId = required(body, "installationId", 128);
    const now = new Date().toISOString();
    const codes = await supabaseRest<PairingRow[]>(
      `/rest/v1/pairing_codes?code_hash=eq.${postgrestValue(codeHash)}&used_at=is.null&expires_at=gt.${postgrestValue(now)}&select=id,user_id&limit=1`,
      { method: "GET" },
      { serviceRole: true },
    );
    const pairing = codes[0];
    if (!pairing) throw new ApiError("invalid_pairing_code", "Pairing code is invalid or expired.", 404);

    const claimed = await supabaseRest<PairingRow[]>(
      `/rest/v1/pairing_codes?id=eq.${postgrestValue(pairing.id)}&used_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { used_at: now },
      },
      { serviceRole: true },
    );
    if (!claimed[0]) throw new ApiError("invalid_pairing_code", "Pairing code is invalid or expired.", 409);

    const deviceToken = randomBearerToken();
    const deviceTokenHash = await hashDeviceToken(deviceToken);
    const platform = body.platform === "android" ? "android" : "unknown";
    const appVersion = typeof body.appVersion === "string" ? body.appVersion.slice(0, 32) : null;
    const devices = await supabaseRest<DeviceRow[]>(
      "/rest/v1/devices?on_conflict=user_id,installation_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: {
          user_id: pairing.user_id,
          platform,
          installation_id: installationId,
          label: platform === "android" ? "Allied Radar Android companion" : "Allied Radar companion",
          device_token_hash: deviceTokenHash,
          capabilities: { whatsappNotifications: true, manualWhatsAppHandoff: true, appVersion },
          is_active: true,
          last_seen_at: now,
        },
      },
      { serviceRole: true },
    );
    const device = devices[0];
    if (!device) throw new ApiError("device_pairing_failed", "Device pairing failed.", 502);

    await supabaseRest<unknown>(
      `/rest/v1/pairing_codes?id=eq.${postgrestValue(pairing.id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { device_id: device.id } },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: pairing.user_id,
      actorType: "device",
      actorId: device.id,
      eventType: "mobile_device_paired",
      deviceId: device.id,
      metadata: { platform, appVersion },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return noStoreJson({ ok: true, deviceId: device.id, deviceToken, pairedAt: now });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
