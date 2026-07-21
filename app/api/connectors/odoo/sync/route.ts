import { plainText, upsertNormalizedMessages, type NormalizedMessage } from "../../../../../lib/connectors/normalized-messages";
import { odooAuthenticate, odooInboxPartnerId, odooRpc } from "../../../../../lib/connectors/odoo";
import { finishConnectorRun, recordErrorEvent, startConnectorRun } from "../../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../../lib/security/auth";
import { ApiError } from "../../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type OdooNotification = {
  id?: number;
  mail_message_id?: [number, string] | number | false;
  res_partner_id?: [number, string] | number | false;
  notification_type?: string | false;
  notification_status?: string | false;
  is_read?: boolean;
};

type OdooMessage = {
  id?: number;
  subject?: string | false;
  body?: string | false;
  date?: string | false;
  author_id?: [number, string] | false;
  model?: string | false;
  res_id?: number | false;
  message_type?: string | false;
  record_name?: string | false;
};

function many2oneId(value: OdooNotification["mail_message_id"]) {
  if (Array.isArray(value)) return typeof value[0] === "number" ? value[0] : null;
  return typeof value === "number" ? value : null;
}

function many2oneName(value: OdooMessage["author_id"]) {
  return Array.isArray(value) && typeof value[1] === "string" ? value[1] : null;
}

function odooDate(value: unknown) {
  return typeof value === "string" ? `${value.replace(" ", "T")}Z` : null;
}

function stableOdooChatKey(name: string | null) {
  const normalized = (name || "Odoo")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `odoo-author:${normalized || "odoo"}`;
}

// Legacy safety contract for the outbound Discuss channel path:
// ["model", "=", discussModel]
// ["res_id", "in", channelIds]
// ["message_type", "=", "comment"]
// The inbox import intentionally uses mail.notification WHERE res_partner_id + notification_type='inbox',
// because that is the real Odoo feed Ferdi confirmed.

export async function POST(request: Request) {
  let runId: string | null = null;
  let runUserId: string | null = null;
  try {
    const { user } = await requireSupabaseUser(request);
    runUserId = user.id;
    runId = await startConnectorRun({ userId: user.id, provider: "odoo_discuss", trigger: "manual" });
    const uid = await odooAuthenticate();
    const partnerId = odooInboxPartnerId();
    const externalAccountId = process.env.ODOO_USERNAME!.trim();

    const connections = await supabaseRest<Array<{ id: string }>>(
      "/rest/v1/connections?on_conflict=user_id,provider,external_account_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: {
          user_id: user.id,
          provider: "odoo_discuss",
          status: "connected",
          display_name: `Odoo inbox · partner ${partnerId}`,
          external_account_id: externalAccountId,
          scopes: ["mail.notification.read", "mail.message.read", `res_partner_id:${partnerId}`],
          token_vault: {},
          last_error_code: null,
          last_error_at: null,
        },
      },
      { serviceRole: true },
    );
    const connectionId = connections[0]?.id ?? null;

    const limit = Number(process.env.ODOO_INBOX_BACKFILL_LIMIT ?? "200");
    const notifications = await odooRpc<OdooNotification[]>("object", "execute_kw", [
      process.env.ODOO_DATABASE,
      uid,
      process.env.ODOO_API_KEY,
      "mail.notification",
      "search_read",
      [[
        ["res_partner_id", "=", partnerId],
        ["notification_type", "=", "inbox"],
      ]],
      {
        fields: ["id", "mail_message_id", "res_partner_id", "notification_type", "notification_status", "is_read"],
        limit,
        order: "id desc",
      },
    ]);

    const messageIds = [...new Set(notifications.map((row) => many2oneId(row.mail_message_id)).filter(Boolean))];
    const messages = messageIds.length
      ? await odooRpc<OdooMessage[]>("object", "execute_kw", [
          process.env.ODOO_DATABASE,
          uid,
          process.env.ODOO_API_KEY,
          "mail.message",
          "search_read",
          [[["id", "in", messageIds]]],
          {
            fields: ["id", "subject", "body", "date", "author_id", "model", "res_id", "message_type", "record_name"],
            limit: messageIds.length,
            order: "date desc, id desc",
          },
        ])
      : [];
    const byMessageId = new Map(messages.filter((message) => message.id).map((message) => [message.id!, message]));

    const normalized: NormalizedMessage[] = notifications.flatMap((notification) => {
      if (!notification.id) return [];
      const messageId = many2oneId(notification.mail_message_id);
      if (!messageId) return [];
      const message = byMessageId.get(messageId);
      if (!message) return [];

      const bodyText = plainText(message.body);
      const recordThread = message.model && message.res_id ? `${message.model}:${message.res_id}` : null;
      const authorName = many2oneName(message.author_id) ?? "Odoo";
      const authorId = many2oneId(message.author_id);
      const subject =
        (typeof message.subject === "string" && plainText(message.subject, 180)) ||
        (typeof message.record_name === "string" && message.record_name) ||
        "Odoo inbox notification";
      const recordContext = [message.record_name, recordThread].filter(Boolean).join(" · ");

      return [{
        user_id: user.id,
        connection_id: connectionId,
        source: "odoo_discuss" as const,
        source_type: "discuss" as const,
        external_id: String(notification.id),
        external_thread_id: stableOdooChatKey(authorName),
        folder_or_channel_id: message.res_id ? String(message.res_id) : null,
        folder_or_channel_name: authorName,
        sender: {
          name: authorName,
          externalId: authorId,
        },
        subject,
        body_text: [recordContext, bodyText || subject].filter(Boolean).join("\n\n"),
        preview: plainText([recordContext, bodyText || subject].filter(Boolean).join(" · "), 500),
        received_at: odooDate(message.date),
        sent_at: odooDate(message.date),
        is_read: Boolean(notification.is_read),
        source_permalink: null,
      }];
    });

    const stored = await upsertNormalizedMessages(normalized);
    const now = new Date().toISOString();
    await supabaseRest<unknown>(
      `/rest/v1/connections?user_id=eq.${postgrestValue(user.id)}&provider=eq.odoo_discuss`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { last_sync_at: now } },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: user.id,
      actorType: "connector",
      actorId: "odoo_discuss",
      eventType: "odoo_inbox_notifications_synced",
      metadata: {
        partnerId,
        notificationsFetched: notifications.length,
        messagesFetched: messages.length,
        stored: stored.length,
        unread: notifications.filter((row) => row.is_read === false).length,
      },
    });
    await finishConnectorRun({
      id: runId,
      userId: user.id,
      status: "success",
      fetchedCount: notifications.length,
      storedCount: stored.length,
      metadata: {
        partnerId,
        messagesFetched: messages.length,
        unread: notifications.filter((row) => row.is_read === false).length,
      },
    });
    return noStoreJson({
      ok: true,
      stored: stored.length,
      fetched: {
        notifications: notifications.length,
        messages: messages.length,
        unread: notifications.filter((row) => row.is_read === false).length,
      },
      syncedAt: now,
    });
  } catch (error) {
    if (runUserId) {
      const code = error instanceof ApiError ? error.code : "odoo_sync_failed";
      const message = error instanceof Error ? error.message : "Odoo sync failed.";
      try {
        await finishConnectorRun({ id: runId, userId: runUserId, status: "failed", errorCode: code, errorMessage: message });
        await recordErrorEvent({ userId: runUserId, source: "odoo_sync", code, message });
      } catch {
        // Keep the original sync error.
      }
    }
    return apiErrorResponse(error);
  }
}
