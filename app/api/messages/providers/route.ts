import { NextResponse } from "next/server";
import { ALLOW_SEND_ACTIONS } from "../../../../lib/guardrails";
import { getProviderStatuses } from "../../../../lib/messaging/providers";
import { getProviderStatusesForUser } from "../../../../lib/messaging/providers";
import { isConfirmationConfigured } from "../../../../lib/messaging/confirmation";
import { requireSupabaseUser } from "../../../../lib/security/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let providers = getProviderStatuses();
  if (request.headers.get("authorization")) {
    try {
      const { user } = await requireSupabaseUser(request);
      providers = await getProviderStatusesForUser(user.id);
    } catch {
      providers = getProviderStatuses();
    }
  }
  return NextResponse.json(
    {
      sendEnabled: ALLOW_SEND_ACTIONS,
      confirmationReady: isConfirmationConfigured(),
      aiMode: "draft_only",
      confirmationRequired: true,
      providers,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
