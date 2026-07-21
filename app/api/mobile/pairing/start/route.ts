import { requireSupabaseUser } from "../../../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { hashPairingCode } from "../../../../../lib/security/hash";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

const PAIRING_TTL_MS = 10 * 60 * 1000;

type PairingCodeRow = {
  id: string;
  expires_at: string;
};

function generatePairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function compactString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const label = compactString(body.label, 80);
    const platformHint = compactString(body.platform, 32);

    const rows = await supabaseRest<PairingCodeRow[]>(
      "/rest/v1/pairing_codes",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          user_id: user.id,
          code_hash: await hashPairingCode(code),
          label,
          platform_hint: platformHint,
          expires_at: expiresAt,
        },
      },
      { serviceRole: true },
    );

    await recordAuditEvent({
      userId: user.id,
      actorType: "user",
      actorId: user.id,
      eventType: "mobile_pairing_code_created",
      metadata: { pairingId: rows[0]?.id ?? null, platformHint },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return noStoreJson({
      ok: true,
      pairingId: rows[0]?.id ?? null,
      code,
      expiresAt,
      instructions: "Enter this code on your mobile companion. It expires in 10 minutes.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
