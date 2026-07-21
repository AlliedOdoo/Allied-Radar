import { encryptProviderToken } from "../../../../../lib/security/aes-gcm";
import { requireSupabaseUser } from "../../../../../lib/security/auth";
import { ApiError } from "../../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

const SCOPES = ["Mail.Read", "Mail.Send", "Chat.Read", "ChatMessage.Send"];

function requiredToken(value: unknown, name: string) {
  if (typeof value !== "string" || value.length < 40 || value.length > 16384) {
    throw new ApiError("invalid_microsoft_session", `${name} is invalid.`, 400);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError("invalid_microsoft_session", "Microsoft session is invalid.", 400);

    const accessToken = requiredToken(body.providerToken, "Microsoft access token");
    const refreshToken =
      typeof body.providerRefreshToken === "string" && body.providerRefreshToken.length >= 40
        ? body.providerRefreshToken
        : null;
    const externalAccountId = user.id;

    const rows = await Promise.all(
      (["outlook", "teams"] as const).map(async (provider) => {
        const tokenVault = {
          accessToken: await encryptProviderToken(accessToken, { userId: user.id, provider }),
          refreshToken: refreshToken
            ? await encryptProviderToken(refreshToken, { userId: user.id, provider })
            : null,
          storedAt: new Date().toISOString(),
        };
        return supabaseRest<Array<{ id: string; provider: string }>>(
          "/rest/v1/connections?on_conflict=user_id,provider,external_account_id",
          {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: {
              user_id: user.id,
              provider,
              status: "connected",
              display_name: user.email ?? "Allied Fibreglass Microsoft 365",
              external_account_id: externalAccountId,
              scopes: provider === "outlook" ? SCOPES.slice(0, 2) : SCOPES.slice(2),
              token_vault: tokenVault,
              last_error_code: null,
              last_error_at: null,
            },
          },
          { serviceRole: true },
        );
      }),
    );

    await recordAuditEvent({
      userId: user.id,
      actorType: "user",
      actorId: user.id,
      eventType: "microsoft_connection_stored",
      metadata: { providers: ["outlook", "teams"], connectionCount: rows.flat().length },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return noStoreJson({ ok: true, providers: ["outlook", "teams"] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
