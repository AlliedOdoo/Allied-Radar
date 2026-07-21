import { requireSupabaseUser } from "../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  source: "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "mobile_notification";
  source_type: string;
  external_id: string;
  external_thread_id: string | null;
  sender: { name?: string; address?: string; phone?: string } | null;
  subject: string | null;
  preview: string | null;
  body_text: string;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  local_status?: string | null;
  opened_at?: string | null;
  acknowledged_at?: string | null;
  importance: "low" | "normal" | "high";
  ai_reason: string | null;
};

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const query = url.searchParams.get("query")?.trim();
    const supported = new Set(["outlook", "teams", "odoo_discuss", "whatsapp", "mobile_notification"]);
    const sourceFilter = source && supported.has(source) ? `&source=eq.${postgrestValue(source)}` : "";
    const queryFilter = query
      ? `&or=(${[
          `subject.ilike.*${postgrestValue(query)}*`,
          `preview.ilike.*${postgrestValue(query)}*`,
          `body_text.ilike.*${postgrestValue(query)}*`,
        ].join(",")})`
      : "";
    const rows = await supabaseRest<MessageRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}${sourceFilter}${queryFilter}&deleted_at=is.null&select=id,source,source_type,external_id,external_thread_id,sender,subject,preview,body_text,received_at,sent_at,is_read,local_status,opened_at,acknowledged_at,importance,ai_reason&order=received_at.desc.nullslast,created_at.desc&limit=100`,
      { method: "GET" },
      { accessToken },
    );
    return noStoreJson({ ok: true, messages: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
