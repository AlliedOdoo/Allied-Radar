import { NextResponse } from "next/server";
import { ALLOW_SEND_ACTIONS } from "../../../../lib/guardrails";
import { consumeConfirmationToken } from "../../../../lib/messaging/confirmation";
import {
  beginOutboundDelivery,
  completeOutboundDelivery,
  failOutboundDelivery,
} from "../../../../lib/messaging/outbound-audit";
import { recordErrorEvent } from "../../../../lib/ops/logging";
import { sendMessage } from "../../../../lib/messaging/providers";
import { MessagingError } from "../../../../lib/messaging/types";
import { parseConfirmedSendRequest } from "../../../../lib/messaging/validation";
import { createWhatsAppHandoff } from "../../../../lib/mobile/handoffs";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse } from "../../../../lib/security/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let outboundId: string | null = null;
  let outboundUserId: string | null = null;
  try {
    const { user } = await requireSupabaseUser(request);
    outboundUserId = user.id;
    if (request.headers.get("X-Allied-User-Intent") !== "confirm-send") {
      throw new MessagingError(
        "explicit_intent_required",
        "Open the review step and confirm Send now",
        409,
      );
    }

    const message = parseConfirmedSendRequest(
      await request.json().catch(() => null),
    );

    if (!ALLOW_SEND_ACTIONS) {
      throw new MessagingError(
        "sending_disabled",
        "Sending is paused. Enable it in the server settings after connecting a provider.",
        503,
      );
    }

    await consumeConfirmationToken(message, message.confirmationToken, user.id);
    outboundId = await beginOutboundDelivery(message, user.id);

    let result = await sendMessage(message, user.id);
    if (message.provider === "WhatsApp" && result.state === "handoff") {
      try {
        const handoff = await createWhatsAppHandoff({
          userId: user.id,
          recipientPhone: message.destination,
          bodyText: message.content,
          ip: request.headers.get("x-forwarded-for"),
          userAgent: request.headers.get("user-agent"),
        });
        result = {
          ...result,
          handoffId: handoff.handoffId,
          handoffExpiresAt: handoff.expiresAt,
          pushQueued: handoff.pushQueued,
          detail: handoff.pushQueued
            ? "The reviewed draft was sent to your phone for final WhatsApp confirmation."
            : "The reviewed handoff was stored, but phone push is unavailable. Open WhatsApp to continue.",
        };
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "no_paired_phone")) throw error;
      }
    }

    let auditFinalized = true;
    try {
      await completeOutboundDelivery(outboundId, user.id, result);
    } catch {
      auditFinalized = false;
    }

    return NextResponse.json(
      {
        ok: true,
        requestId: message.clientRequestId,
        auditFinalized,
        ...result,
      },
      {
        status: result.state === "accepted" ? 202 : 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (outboundId && outboundUserId) {
      const errorCode =
        error instanceof MessagingError || error instanceof ApiError
          ? error.code
          : "provider_failure";
      try {
        await failOutboundDelivery(outboundId, outboundUserId, errorCode);
        await recordErrorEvent({
          userId: outboundUserId,
          source: "send",
          code: errorCode,
          message: error instanceof Error ? error.message : "Message send failed.",
        });
      } catch {
        // The durable authorized record remains available for reconciliation.
      }
    }

    if (error instanceof MessagingError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        {
          status: error.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (error instanceof ApiError) return apiErrorResponse(error);

    return NextResponse.json(
      {
        ok: false,
        code: "send_failed",
        error: "The provider could not be reached. Nothing was retried automatically.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
