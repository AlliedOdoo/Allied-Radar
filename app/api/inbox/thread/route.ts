import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  source: "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "mobile_notification";
  source_type: string;
  external_id: string;
  external_thread_id: string | null;
  sender: { name?: string; address?: string; phone?: string } | null;
  recipients: unknown;
  participants: unknown;
  subject: string | null;
  preview: string | null;
  body_text: string;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  is_flagged: boolean;
  mail_folder?: string | null;
  provider_state?: Record<string, unknown> | null;
  local_status?: string | null;
  opened_at?: string | null;
  acknowledged_at?: string | null;
  importance: "low" | "normal" | "high";
  ai_reason: string | null;
};

const SELECT =
  "id,source,source_type,external_id,external_thread_id,sender,recipients,participants,subject,preview,body_text,received_at,sent_at,is_read,is_flagged,mail_folder,provider_state,local_status,opened_at,acknowledged_at,importance,ai_reason";

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const messageId = url.searchParams.get("messageId")?.trim();
    if (!messageId) {
      throw new ApiError("invalid_thread_request", "messageId is required.", 400);
    }

    const [anchor] = await supabaseRest<MessageRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}&id=eq.${postgrestValue(messageId)}&deleted_at=is.null&select=${SELECT}&limit=1`,
      { method: "GET" },
      { accessToken },
    );
    if (!anchor) return noStoreJson({ ok: true, messages: [] });

    const threadKey = anchor.external_thread_id || anchor.external_id;
    const threadFilter = anchor.external_thread_id
      ? `external_thread_id=eq.${postgrestValue(threadKey)}`
      : `external_id=eq.${postgrestValue(threadKey)}`;

    const rows = await supabaseRest<MessageRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}&source=eq.${postgrestValue(anchor.source)}&${threadFilter}&deleted_at=is.null&select=${SELECT}&order=received_at.asc.nullslast,created_at.asc&limit=200`,
      { method: "GET" },
      { accessToken },
    );

    return noStoreJson({ ok: true, messages: rows.length ? rows : [anchor] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
