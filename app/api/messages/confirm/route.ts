import { NextResponse } from "next/server";
import { ALLOW_SEND_ACTIONS } from "../../../../lib/guardrails";
import { createConfirmationToken } from "../../../../lib/messaging/confirmation";
import { MessagingError } from "../../../../lib/messaging/types";
import { parseConfirmedSendRequest } from "../../../../lib/messaging/validation";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse } from "../../../../lib/security/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    if (request.headers.get("X-Allied-User-Intent") !== "review-message") {
      throw new MessagingError(
        "explicit_review_required",
        "Open the final review before preparing a send",
        409,
      );
    }
    if (!ALLOW_SEND_ACTIONS) {
      throw new MessagingError(
        "sending_disabled",
        "Sending is paused in server settings.",
        503,
      );
    }

    const message = parseConfirmedSendRequest(
      await request.json().catch(() => null),
    );
    const confirmation = await createConfirmationToken(message, user.id);
    return NextResponse.json(confirmation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof MessagingError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json(
      { ok: false, code: "review_failed", error: "Unable to prepare this send." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
