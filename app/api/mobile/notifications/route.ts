import { requireDevice } from "../../../../lib/security/device-auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { recordAuditEvent } from "../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

const ALLOWED_PACKAGES = new Set(["com.whatsapp", "com.whatsapp.w4b"]);

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function timestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export async function POST(request: Request) {
  try {
    const { device } = await requireDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError("invalid_notification_payload", "Notification payload is invalid.", 400);

    const sourcePackage = text(body.sourcePackage, 80);
    if (!sourcePackage || !ALLOWED_PACKAGES.has(sourcePackage)) {
      throw new ApiError("unsupported_notification_source", "Only WhatsApp notifications are accepted.", 400);
    }
    const installationId = text(body.installationId, 128);
    if (device.installation_id && installationId !== device.installation_id) {
      throw new ApiError("device_auth_failed", "Device authentication failed.", 401);
    }
    const title = text(body.title, 300);
    const bodyText = text(body.text, 10000);
    if (!title && !bodyText) {
      throw new ApiError("empty_notification", "Notification does not contain visible message content.", 400);
    }
    const receivedAt = timestamp(body.postedAt) ?? new Date().toISOString();
    const notificationKey = text(body.notificationKey, 512);
    const externalId =
      notificationKey || `${installationId || device.id}:${String(body.postedAt)}:${String(body.capturedAt)}`;

    const rows = await supabaseRest<Array<{ id: string }>>(
      "/rest/v1/messages?on_conflict=user_id,source,external_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: {
          user_id: device.user_id,
          source: "whatsapp",
          source_type: "whatsapp",
          external_id: externalId,
          external_thread_id: title,
          sender: { displayName: title },
          subject: title,
          body_text: bodyText || "Message preview hidden on phone",
          preview: (bodyText || "Message preview hidden on phone").slice(0, 240),
          received_at: receivedAt,
          raw_payload: {
            ingestion: "android_notification",
            sourcePackage,
            capturedAt: timestamp(body.capturedAt),
          },
        },
      },
      { serviceRole: true },
    );
    const now = new Date().toISOString();
    await supabaseRest<unknown>(
      `/rest/v1/devices?id=eq.${postgrestValue(device.id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { last_seen_at: now } },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: device.user_id,
      actorType: "device",
      actorId: device.id,
      eventType: "whatsapp_notification_ingested",
      deviceId: device.id,
      messageId: rows[0]?.id ?? null,
      metadata: { sourcePackage },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return noStoreJson({ ok: true, messageId: rows[0]?.id ?? null, ingestedAt: now });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
