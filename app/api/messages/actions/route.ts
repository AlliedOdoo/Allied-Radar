import { graphAccessToken } from "../../../../lib/messaging/providers";
import { recordErrorEvent } from "../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { recordAuditEvent } from "../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  user_id: string;
  source: string;
  external_id: string;
  mail_folder: string | null;
};

type ActionRequest = {
  messageId?: string;
  action?: "mark_read" | "mark_unread" | "flag" | "unflag" | "archive" | "delete" | "move";
  destinationFolder?: string;
};

const MOVE_DESTINATIONS: Record<string, string> = {
  archive: "archive",
  delete: "deleteditems",
  junk: "junkemail",
  inbox: "inbox",
};

async function graphRequest(token: string, path: string, init: RequestInit) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError(
      "graph_message_action_failed",
      payload?.error?.message || "Microsoft Graph could not complete the message action.",
      response.status,
    );
  }
  return response;
}

export async function POST(request: Request) {
  let userIdForError: string | null = null;
  try {
    const { user } = await requireSupabaseUser(request);
    userIdForError = user.id;
    const body = (await request.json().catch(() => null)) as ActionRequest | null;
    if (!body?.messageId || !body.action) {
      throw new ApiError("invalid_message_action", "messageId and action are required.", 400);
    }

    const [message] = await supabaseRest<MessageRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}&id=eq.${postgrestValue(body.messageId)}&select=id,user_id,source,external_id,mail_folder&limit=1`,
      { method: "GET" },
      { serviceRole: true },
    );
    if (!message) throw new ApiError("message_not_found", "The selected message could not be found.", 404);
    if (message.source !== "outlook") {
      throw new ApiError("message_action_not_supported", "This action is currently only wired for Outlook mail.", 409);
    }

    const token = await graphAccessToken(user.id, "outlook");
    const now = new Date().toISOString();
    let patch: Record<string, unknown> = { updated_at: now };

    if (body.action === "mark_read" || body.action === "mark_unread") {
      const isRead = body.action === "mark_read";
      await graphRequest(token, `/me/messages/${encodeURIComponent(message.external_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead }),
      });
      patch = { ...patch, is_read: isRead };
    } else if (body.action === "flag" || body.action === "unflag") {
      const flagStatus = body.action === "flag" ? "flagged" : "notFlagged";
      await graphRequest(token, `/me/messages/${encodeURIComponent(message.external_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ flag: { flagStatus } }),
      });
      patch = { ...patch, is_flagged: body.action === "flag", provider_state: { flagStatus } };
    } else {
      const destination = body.action === "move"
        ? body.destinationFolder?.trim().toLowerCase()
        : body.action;
      const destinationId = destination ? MOVE_DESTINATIONS[destination] : null;
      if (!destinationId) throw new ApiError("invalid_destination_folder", "Destination folder is not supported yet.", 400);
      await graphRequest(token, `/me/messages/${encodeURIComponent(message.external_id)}/move`, {
        method: "POST",
        body: JSON.stringify({ destinationId }),
      });
      patch = {
        ...patch,
        mail_folder: destination === "delete" ? "deleted" : destination,
      };
    }

    await supabaseRest<unknown>(
      `/rest/v1/messages?id=eq.${postgrestValue(message.id)}&user_id=eq.${postgrestValue(user.id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: patch },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: user.id,
      actorType: "user",
      actorId: user.email ?? user.id,
      eventType: `outlook_${body.action}`,
      messageId: message.id,
      metadata: { destinationFolder: body.destinationFolder ?? null },
    });

    return noStoreJson({ ok: true, action: body.action, patch });
  } catch (error) {
    if (userIdForError) {
      try {
      await recordErrorEvent({
        userId: userIdForError,
        source: "message_action",
        code: error instanceof ApiError ? error.code : "message_action_failed",
        message: error instanceof Error ? error.message : "Message action failed.",
      });
      } catch {
      // Preserve the original error response.
      }
    }
    return apiErrorResponse(error);
  }
}
