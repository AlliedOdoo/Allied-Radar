import { recordErrorEvent } from "../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type ErrorRow = {
  id: string;
  source: string;
  severity: string;
  code: string | null;
  message: string;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const rows = await supabaseRest<ErrorRow[]>(
      `/rest/v1/error_events?or=(user_id.eq.${postgrestValue(user.id)},user_id.is.null)&select=id,source,severity,code,message,created_at&order=created_at.desc&limit=20`,
      { method: "GET" },
      { accessToken },
    );
    return noStoreJson({ ok: true, errors: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    await recordErrorEvent({
      userId: user.id,
      source: typeof body?.source === "string" ? body.source : "client",
      severity: body?.severity === "warn" || body?.severity === "critical" || body?.severity === "info" ? body.severity : "error",
      code: typeof body?.code === "string" ? body.code : undefined,
      message: typeof body?.message === "string" ? body.message : "Client error",
      metadata: typeof body?.metadata === "object" && body.metadata ? body.metadata : {},
    });
    return noStoreJson({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
