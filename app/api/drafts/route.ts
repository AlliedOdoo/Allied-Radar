import { requireSupabaseUser } from "../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  provider: string;
  thread_key: string;
  reply_mode: string | null;
  destination: string | null;
  subject: string | null;
  content: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

function validProvider(value: unknown) {
  return value === "Outlook" || value === "Teams" || value === "Odoo Discuss" || value === "WhatsApp";
}

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const threadKey = url.searchParams.get("threadKey");
    const replyMode = url.searchParams.get("replyMode") ?? "new";
    if (!validProvider(provider) || !threadKey) return noStoreJson({ ok: true, draft: null });

    const rows = await supabaseRest<DraftRow[]>(
      `/rest/v1/thread_drafts?user_id=eq.${postgrestValue(user.id)}&provider=eq.${postgrestValue(provider)}&thread_key=eq.${postgrestValue(threadKey)}&reply_mode=eq.${postgrestValue(replyMode)}&select=id,provider,thread_key,reply_mode,destination,subject,content,metadata,updated_at&limit=1`,
      { method: "GET" },
      { accessToken },
    );
    return noStoreJson({ ok: true, draft: rows[0] ?? null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const provider = body?.provider;
    const threadKey = typeof body?.threadKey === "string" ? body.threadKey.trim() : "";
    const replyMode = typeof body?.replyMode === "string" ? body.replyMode : "new";
    const content = typeof body?.content === "string" ? body.content : "";
    if (!validProvider(provider) || !threadKey) {
      return noStoreJson({ ok: false, error: "Draft needs a provider and thread key." }, { status: 400 });
    }

    const rows = await supabaseRest<DraftRow[]>(
      "/rest/v1/thread_drafts?on_conflict=user_id,provider,thread_key,reply_mode",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: {
          user_id: user.id,
          provider,
          thread_key: threadKey,
          reply_mode: replyMode,
          destination: typeof body.destination === "string" ? body.destination : null,
          subject: typeof body.subject === "string" ? body.subject : null,
          content,
          metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
        },
      },
      { serviceRole: true },
    );
    return noStoreJson({ ok: true, draft: rows[0] ?? null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
