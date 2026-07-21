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
  is_flagged: boolean;
  mail_folder?: string | null;
  provider_state?: Record<string, unknown> | null;
  local_status?: string | null;
  opened_at?: string | null;
  acknowledged_at?: string | null;
  importance: "low" | "normal" | "high";
  ai_reason: string | null;
};

function searchTerms(query: string) {
  const stopWords = new Set([
    "a",
    "about",
    "all",
    "and",
    "any",
    "chat",
    "chats",
    "comm",
    "comms",
    "communication",
    "communications",
    "email",
    "emails",
    "find",
    "for",
    "from",
    "in",
    "mail",
    "mails",
    "message",
    "messages",
    "of",
    "on",
    "search",
    "show",
    "the",
    "to",
    "with",
  ]);
  const terms = query
    .split(/[^a-zA-Z0-9@._+-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !stopWords.has(term.toLowerCase()));
  return terms.length ? terms.slice(0, 8) : [query];
}

function inboxSearchFilter(query?: string) {
  if (!query) return "";
  const filters = searchTerms(query).flatMap((term) => {
    const value = postgrestValue(term);
    return [
      `subject.ilike.*${value}*`,
      `preview.ilike.*${value}*`,
      `body_text.ilike.*${value}*`,
      `sender->>name.ilike.*${value}*`,
      `sender->>address.ilike.*${value}*`,
      `sender->>phone.ilike.*${value}*`,
    ];
  });
  return `&or=(${filters.join(",")})`;
}

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const folder = url.searchParams.get("folder")?.trim();
    const query = url.searchParams.get("query")?.trim();
    const supported = new Set(["outlook", "teams", "odoo_discuss", "whatsapp", "mobile_notification"]);
    const sourceFilter = source && supported.has(source) ? `&source=eq.${postgrestValue(source)}` : "";
    const folderFilter = folder ? `&mail_folder=eq.${postgrestValue(folder)}` : "";
    const unreadFilter = url.searchParams.get("unread") === "true" ? "&is_read=eq.false" : "";
    const flaggedFilter = url.searchParams.get("flagged") === "true" ? "&is_flagged=eq.true" : "";
    const queryFilter = inboxSearchFilter(query);
    const rows = await supabaseRest<MessageRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}${sourceFilter}${folderFilter}${unreadFilter}${flaggedFilter}${queryFilter}&deleted_at=is.null&select=id,source,source_type,external_id,external_thread_id,sender,subject,preview,body_text,received_at,sent_at,is_read,is_flagged,mail_folder,provider_state,local_status,opened_at,acknowledged_at,importance,ai_reason&order=received_at.desc.nullslast,sent_at.desc.nullslast,created_at.desc&limit=150`,
      { method: "GET" },
      { accessToken },
    );
    return noStoreJson({ ok: true, messages: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
