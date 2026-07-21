import { requireSupabaseUser } from "../../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => null)) as { messageId?: string; action?: string } | null;
    if (!body?.messageId) return noStoreJson({ ok: false, error: "messageId is required." }, { status: 400 });
    const now = new Date().toISOString();
    const patch =
      body.action === "acknowledge"
        ? { acknowledged_at: now, opened_at: now, local_status: "acknowledged" }
        : { opened_at: now, local_status: "opened" };
    await supabaseRest<unknown>(
      `/rest/v1/messages?id=eq.${postgrestValue(body.messageId)}&user_id=eq.${postgrestValue(user.id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: patch },
      { serviceRole: true },
    );
    return noStoreJson({ ok: true, ...patch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
