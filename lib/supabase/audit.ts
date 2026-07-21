import { hashAuditValue } from "../security/hash";
import { supabaseRest } from "./rest";

type AuditEvent = {
  userId?: string | null;
  actorType: "user" | "device" | "connector" | "system";
  actorId?: string | null;
  eventType: string;
  connectionId?: string | null;
  deviceId?: string | null;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordAuditEvent(event: AuditEvent) {
  try {
    await supabaseRest<unknown>(
      "/rest/v1/audit_events",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: {
          user_id: event.userId ?? null,
          actor_type: event.actorType,
          actor_id: event.actorId ?? null,
          event_type: event.eventType,
          connection_id: event.connectionId ?? null,
          device_id: event.deviceId ?? null,
          message_id: event.messageId ?? null,
          metadata: event.metadata ?? {},
          ip_hash: await hashAuditValue(event.ip ?? null),
          user_agent_hash: await hashAuditValue(event.userAgent ?? null),
        },
      },
      { serviceRole: true },
    );
  } catch {
    // Audit writes are best-effort in this scaffold and intentionally do not log request data.
  }
}
