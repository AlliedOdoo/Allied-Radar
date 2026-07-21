import { plainText, upsertNormalizedMessages, type NormalizedMessage } from "../../../../../lib/connectors/normalized-messages";
import { graphAccessToken } from "../../../../../lib/messaging/providers";
import { finishConnectorRun, recordErrorEvent, startConnectorRun } from "../../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../../lib/security/auth";
import { ApiError } from "../../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../../lib/security/http";
import { recordAuditEvent } from "../../../../../lib/supabase/audit";
import { postgrestValue, supabaseRest } from "../../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type ConnectionRow = { id: string; provider: "outlook" | "teams" };
type GraphCollection<T> = { value?: T[]; "@odata.nextLink"?: string };
type GraphMail = {
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  lastModifiedDateTime?: string;
  isRead?: boolean;
  importance?: "low" | "normal" | "high";
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
};
type GraphChat = {
  id?: string;
  topic?: string | null;
  webUrl?: string;
  lastMessagePreview?: {
    id?: string;
    createdDateTime?: string;
    body?: { content?: string };
    from?: { user?: { displayName?: string; id?: string } };
  } | null;
};
type GraphChatMessage = {
  id?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  body?: { content?: string };
  from?: { user?: { displayName?: string; id?: string } };
  chatId?: string;
  webUrl?: string;
};

async function graphGet<T>(token: string, pathOrUrl: string) {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (response.status === 401) {
    throw new ApiError("microsoft_reconnect_required", "Microsoft 365 needs to be reconnected.", 401);
  }
  if (!response.ok) throw new ApiError("microsoft_sync_failed", "Microsoft 365 sync failed.", 502);
  return (await response.json()) as T;
}

async function graphGetPaged<T>(
  token: string,
  initialPath: string,
  maxItems: number,
) {
  const items: T[] = [];
  let next: string | undefined = initialPath;
  while (next && items.length < maxItems) {
    const page = await graphGet<GraphCollection<T>>(token, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }
  return items.slice(0, maxItems);
}

export async function POST(request: Request) {
  let runId: string | null = null;
  let runUserId: string | null = null;
  try {
    const { user } = await requireSupabaseUser(request);
    runUserId = user.id;
    runId = await startConnectorRun({ userId: user.id, provider: "all", trigger: "manual", metadata: { connector: "microsoft" } });
    const connections = await supabaseRest<ConnectionRow[]>(
      `/rest/v1/connections?user_id=eq.${postgrestValue(user.id)}&provider=in.(outlook,teams)&status=eq.connected&select=id,provider`,
      { method: "GET" },
      { serviceRole: true },
    );
    const ids = new Map(connections.map((row) => [row.provider, row.id]));
    if (!ids.get("outlook") || !ids.get("teams")) {
      throw new ApiError("microsoft_not_connected", "Connect Microsoft 365 before syncing.", 409);
    }

    const mailLimit = Number(process.env.MICROSOFT_BACKFILL_MAIL_LIMIT ?? "1000");
    const chatLimit = Number(process.env.MICROSOFT_BACKFILL_CHAT_LIMIT ?? "50");
    const chatMessagesPerChat = Number(process.env.MICROSOFT_BACKFILL_CHAT_MESSAGES_PER_CHAT ?? "25");
    const mailPath = "/me/messages?$top=50&$select=id,conversationId,subject,bodyPreview,receivedDateTime,sentDateTime,lastModifiedDateTime,isRead,importance,webLink,from,toRecipients&$orderby=receivedDateTime%20desc";
    const chatsPath = "/me/chats?$top=50&$expand=lastMessagePreview";

    const normalized: NormalizedMessage[] = [];
    const errors: Array<{ provider: string; message: string }> = [];
    let mailItems: GraphMail[] = [];
    let chatItems: GraphChat[] = [];
    let chatMessagesByChat: Array<PromiseSettledResult<{ chat: GraphChat; messages: GraphChatMessage[] }>> = [];

    const outlookResult = await Promise.allSettled([
      graphAccessToken(user.id, "outlook"),
    ]);
    if (outlookResult[0]?.status === "fulfilled") {
      try {
        mailItems = await graphGetPaged<GraphMail>(outlookResult[0].value, mailPath, mailLimit);
        for (const item of mailItems) {
          if (!item.id) continue;
          const sender = item.from?.emailAddress ?? {};
          normalized.push({
            user_id: user.id,
            connection_id: ids.get("outlook"),
            source: "outlook",
            source_type: "email",
            external_id: item.id,
            external_thread_id: item.conversationId ?? null,
            sender: { name: sender.name ?? sender.address ?? "Unknown sender", address: sender.address ?? null },
            recipients: (item.toRecipients ?? []).map((entry) => ({
              name: entry.emailAddress?.name ?? null,
              address: entry.emailAddress?.address ?? null,
            })),
            subject: item.subject ?? "(No subject)",
            body_text: plainText(item.bodyPreview),
            preview: plainText(item.bodyPreview, 500),
            received_at: item.receivedDateTime ?? null,
            sent_at: item.sentDateTime ?? null,
            external_updated_at: item.lastModifiedDateTime ?? null,
            is_read: Boolean(item.isRead),
            importance: item.importance ?? "normal",
            source_permalink: item.webLink ?? null,
          });
        }
      } catch (error) {
        errors.push({
          provider: "outlook",
          message: error instanceof Error ? error.message : "Outlook sync failed.",
        });
      }
    } else {
      errors.push({ provider: "outlook", message: "Outlook token could not be loaded." });
    }

    const teamsResult = await Promise.allSettled([
      graphAccessToken(user.id, "teams"),
    ]);
    if (teamsResult[0]?.status === "fulfilled") {
      try {
        chatItems = await graphGetPaged<GraphChat>(teamsResult[0].value, chatsPath, chatLimit);
        chatMessagesByChat = await Promise.allSettled(
          chatItems
            .filter((chat) => Boolean(chat.id))
            .map(async (chat) => ({
              chat,
              messages: await graphGetPaged<GraphChatMessage>(
                teamsResult[0].status === "fulfilled" ? teamsResult[0].value : "",
                `/me/chats/${encodeURIComponent(chat.id!)}/messages?$top=25`,
                chatMessagesPerChat,
              ),
            })),
        );
        for (const result of chatMessagesByChat) {
          if (result.status !== "fulfilled") continue;
          const { chat, messages } = result.value;
          for (const message of messages) {
            if (!chat.id || !message.id) continue;
            const bodyText = plainText(message.body?.content);
            if (!bodyText) continue;
            normalized.push({
              user_id: user.id,
              connection_id: ids.get("teams"),
              source: "teams",
              source_type: "chat",
              external_id: message.id,
              external_thread_id: chat.id,
              folder_or_channel_id: chat.id,
              folder_or_channel_name: chat.topic ?? "Teams chat",
              sender: {
                name: message.from?.user?.displayName ?? chat.topic ?? "Teams",
                externalId: message.from?.user?.id ?? null,
              },
              subject: chat.topic ?? "Teams chat",
              body_text: bodyText,
              preview: plainText(bodyText, 500),
              received_at: message.createdDateTime ?? null,
              sent_at: message.createdDateTime ?? null,
              external_updated_at: message.lastModifiedDateTime ?? null,
              is_read: false,
              source_permalink: message.webUrl ?? chat.webUrl ?? null,
            });
          }
        }
        const failedChatRequests = chatMessagesByChat.filter((result) => result.status === "rejected").length;
        if (failedChatRequests) {
          errors.push({
            provider: "teams",
            message: `${failedChatRequests} Teams chat message request${failedChatRequests === 1 ? "" : "s"} failed.`,
          });
        }
      } catch (error) {
        errors.push({
          provider: "teams",
          message: error instanceof Error ? error.message : "Teams sync failed.",
        });
      }
    } else {
      errors.push({ provider: "teams", message: "Teams token could not be loaded." });
    }

    if (!normalized.length) {
      throw new ApiError(
        "microsoft_sync_failed",
        errors.length
          ? errors.map((error) => `${error.provider}: ${error.message}`).join(" ")
          : "Microsoft 365 returned no messages to import.",
        502,
      );
    }

    const stored = await upsertNormalizedMessages(normalized);
    const now = new Date().toISOString();
    await supabaseRest<unknown>(
      `/rest/v1/connections?user_id=eq.${postgrestValue(user.id)}&provider=in.(outlook,teams)`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { last_sync_at: now } },
      { serviceRole: true },
    );
    await recordAuditEvent({
      userId: user.id,
      actorType: "connector",
      actorId: "microsoft",
      eventType: "microsoft_messages_synced",
      metadata: {
        stored: stored.length,
        mailFetched: mailItems.length,
        chatsFetched: chatItems.length,
        teamsChatResults: chatMessagesByChat.length,
      },
    });
    await finishConnectorRun({
      id: runId,
      userId: user.id,
      status: errors.length ? "partial" : "success",
      fetchedCount: mailItems.length + chatMessagesByChat.length,
      storedCount: stored.length,
      errorCode: errors.length ? "microsoft_partial_sync" : undefined,
      errorMessage: errors.map((error) => `${error.provider}: ${error.message}`).join(" "),
      metadata: {
        mailFetched: mailItems.length,
        chatsFetched: chatItems.length,
        teamsChatResults: chatMessagesByChat.length,
      },
    });
    return noStoreJson({
      ok: true,
      stored: stored.length,
      fetched: {
        outlookMessages: mailItems.length,
        teamsChats: chatItems.length,
        teamsChatRequests: chatMessagesByChat.length,
      },
      syncedAt: now,
    });
  } catch (error) {
    if (runUserId) {
      const code = error instanceof ApiError ? error.code : "microsoft_sync_failed";
      const message = error instanceof Error ? error.message : "Microsoft sync failed.";
      try {
        await finishConnectorRun({
          id: runId,
          userId: runUserId,
          status: "failed",
          errorCode: code,
          errorMessage: message,
        });
        await recordErrorEvent({ userId: runUserId, source: "microsoft_sync", code, message });
      } catch {
        // Keep the original sync error.
      }
    }
    return apiErrorResponse(error);
  }
}
