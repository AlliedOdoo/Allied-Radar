import {
  MESSAGE_PROVIDERS,
  MessagingError,
  type OutboundMessage,
  type ProviderStatus,
  type SendResult,
} from "./types";
import { decryptProviderToken, encryptProviderToken, type EncryptedTokenEnvelope } from "../security/aes-gcm";
import { odooDiscussScope } from "../connectors/odoo";
import { postgrestValue, supabaseRest } from "../supabase/rest";

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function staticGraphToken(provider: "Outlook" | "Teams") {
  return provider === "Outlook"
    ? process.env.MICROSOFT_OUTLOOK_ACCESS_TOKEN ??
        process.env.MICROSOFT_GRAPH_ACCESS_TOKEN
    : process.env.MICROSOFT_TEAMS_ACCESS_TOKEN ??
        process.env.MICROSOFT_GRAPH_ACCESS_TOKEN;
}

export function getProviderStatuses(): ProviderStatus[] {
  const statuses: Record<(typeof MESSAGE_PROVIDERS)[number], ProviderStatus> = {
    Outlook: {
      provider: "Outlook",
      configured: configured(staticGraphToken("Outlook")),
      delivery: "api",
      detail: "Microsoft Graph delegated access with Mail.Send",
    },
    Teams: {
      provider: "Teams",
      configured: configured(staticGraphToken("Teams")),
      delivery: "api",
      detail: "Microsoft Graph delegated access with ChatMessage.Send",
    },
    "Odoo Discuss": {
      provider: "Odoo Discuss",
      configured: [
        process.env.ODOO_URL,
        process.env.ODOO_DATABASE,
        process.env.ODOO_USERNAME,
        process.env.ODOO_API_KEY,
        process.env.ODOO_DISCUSS_CHANNEL_IDS,
      ].every(configured),
      delivery: "api",
      detail: "Odoo JSON-RPC access to the Discuss channel",
    },
    WhatsApp: {
      provider: "WhatsApp",
      configured: true,
      delivery: "handoff",
      detail: "Reviewed handoff to personal WhatsApp; you press Send there",
    },
  };

  return MESSAGE_PROVIDERS.map((provider) => statuses[provider]);
}

type ConnectionRow = {
  id: string;
  provider: "outlook" | "teams";
  status: string;
  token_vault: {
    accessToken?: EncryptedTokenEnvelope;
    refreshToken?: EncryptedTokenEnvelope | null;
    storedAt?: string;
  };
};

const graphRefreshes = new Map<string, Promise<string>>();

async function graphConnection(userId: string, provider: "outlook" | "teams") {
  const rows = await supabaseRest<ConnectionRow[]>(
    `/rest/v1/connections?user_id=eq.${postgrestValue(userId)}&provider=eq.${provider}&status=eq.connected&select=id,provider,status,token_vault&limit=1`,
    { method: "GET" },
    { serviceRole: true },
  );
  return rows[0] ?? null;
}

export async function graphAccessToken(userId: string, provider: "outlook" | "teams") {
  const connection = await graphConnection(userId, provider);
  if (!connection?.token_vault?.accessToken) {
    const fallback = staticGraphToken(provider === "outlook" ? "Outlook" : "Teams");
    if (fallback) return fallback;
    throw new MessagingError(
      "provider_not_connected",
      `${provider === "outlook" ? "Outlook" : "Teams"} needs to be reconnected`,
      401,
    );
  }
  try {
    const accessToken = await decryptProviderToken(connection.token_vault.accessToken, {
      userId,
      provider,
    });
    if (tokenIsFresh(accessToken)) return accessToken;
    if (!connection.token_vault.refreshToken) {
      throw new Error("refresh token unavailable");
    }
    const currentRefresh = graphRefreshes.get(userId);
    if (currentRefresh) return await currentRefresh;
    const refresh = refreshMicrosoftToken(userId, provider, connection.token_vault.refreshToken);
    graphRefreshes.set(userId, refresh);
    try {
      return await refresh;
    } finally {
      graphRefreshes.delete(userId);
    }
  } catch {
    throw new MessagingError(
      "provider_auth_failed",
      `${provider === "outlook" ? "Outlook" : "Teams"} needs to be reconnected`,
      401,
    );
  }
}

function tokenIsFresh(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4))) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp * 1000 > Date.now() + 120_000;
  } catch {
    return false;
  }
}

async function refreshMicrosoftToken(
  userId: string,
  provider: "outlook" | "teams",
  envelope: EncryptedTokenEnvelope,
) {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim();
  if (!clientId || !tenantId) throw new Error("Microsoft OAuth configuration is incomplete");
  const refreshToken = await decryptProviderToken(envelope, { userId, provider });
  const tokenRequest = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (clientSecret) tokenRequest.set("client_secret", clientSecret);
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequest,
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    await supabaseRest<unknown>(
      `/rest/v1/connections?user_id=eq.${postgrestValue(userId)}&provider=in.(outlook,teams)`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          status: "needs_auth",
          last_error_code: "token_refresh_failed",
          last_error_at: new Date().toISOString(),
        },
      },
      { serviceRole: true },
    );
    throw new Error("Microsoft token refresh failed");
  }

  const rows = await supabaseRest<Array<{ id: string; provider: "outlook" | "teams" }>>(
    `/rest/v1/connections?user_id=eq.${postgrestValue(userId)}&provider=in.(outlook,teams)&select=id,provider`,
    { method: "GET" },
    { serviceRole: true },
  );
  await Promise.all(
    rows.map(async (row) => {
      const rotatedRefresh = payload.refresh_token || refreshToken;
      return supabaseRest<unknown>(
        `/rest/v1/connections?id=eq.${postgrestValue(row.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: {
            status: "connected",
            token_vault: {
              accessToken: await encryptProviderToken(payload.access_token!, {
                userId,
                provider: row.provider,
              }),
              refreshToken: await encryptProviderToken(rotatedRefresh, {
                userId,
                provider: row.provider,
              }),
              storedAt: new Date().toISOString(),
            },
            last_error_code: null,
            last_error_at: null,
          },
        },
        { serviceRole: true },
      );
    }),
  );
  return payload.access_token;
}

export async function getProviderStatusesForUser(userId: string): Promise<ProviderStatus[]> {
  const rows = await supabaseRest<Array<{ provider: string; status: string }>>(
    `/rest/v1/connections?user_id=eq.${postgrestValue(userId)}&select=provider,status`,
    { method: "GET" },
    { serviceRole: true },
  );
  const connected = new Set(rows.filter((row) => row.status === "connected").map((row) => row.provider));
  return getProviderStatuses().map((status) => {
    if (status.provider === "Outlook") {
      return { ...status, configured: connected.has("outlook") || status.configured };
    }
    if (status.provider === "Teams") {
      return { ...status, configured: connected.has("teams") || status.configured };
    }
    return status;
  });
}

function requireProvider(provider: OutboundMessage["provider"]) {
  const status = getProviderStatuses().find(
    (candidate) => candidate.provider === provider,
  );

  if (!status?.configured) {
    throw new MessagingError(
      "provider_not_configured",
      `${provider} is not connected for sending yet`,
      503,
    );
  }
}

async function providerFailure(response: Response, provider: string) {
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    detail =
      typeof body.error === "string"
        ? body.error
        : body.error?.message ?? body.message ?? "";
  } catch {
    detail = "";
  }

  throw new MessagingError(
    "provider_rejected",
    detail
      ? `${provider} rejected the message: ${detail}`
      : `${provider} rejected the message`,
    response.status >= 400 && response.status < 600 ? response.status : 502,
  );
}

async function sendOutlook(message: OutboundMessage, token: string): Promise<SendResult> {
  const recipients = (addresses: string[] = []) =>
    addresses.map((address) => ({ emailAddress: { address } }));

  if (message.replyToId && (message.cc?.length || message.bcc?.length)) {
    const createReplyUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.replyToId)}/${message.replyMode === "reply_all" ? "createReplyAll" : "createReply"}`;
    const createResponse = await fetch(createReplyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "client-request-id": message.clientRequestId,
      },
    });

    if (!createResponse.ok) await providerFailure(createResponse, "Outlook");
    const draft = (await createResponse.json().catch(() => ({}))) as { id?: string };
    if (!draft.id) {
      throw new MessagingError("provider_rejected", "Outlook did not return a reply draft", 502);
    }

    const patchResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "client-request-id": message.clientRequestId,
      },
      body: JSON.stringify({
        body: { contentType: "Text", content: message.content },
        ...(message.cc?.length ? { ccRecipients: recipients(message.cc) } : {}),
        ...(message.bcc?.length ? { bccRecipients: recipients(message.bcc) } : {}),
      }),
    });

    if (!patchResponse.ok) await providerFailure(patchResponse, "Outlook");

    const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "client-request-id": message.clientRequestId,
      },
    });

    if (!sendResponse.ok) await providerFailure(sendResponse, "Outlook");

    return {
      provider: "Outlook",
      state: "accepted",
      providerMessageId: draft.id,
      detail: "Outlook accepted the reply with CC/BCC recipients and saved it to Sent Items.",
    };
  }

  const replyUrl = message.replyToId
    ? `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.replyToId)}/${message.replyMode === "reply_all" ? "replyAll" : "reply"}`
    : "https://graph.microsoft.com/v1.0/me/sendMail";
  const body = message.replyToId
    ? { comment: message.content }
    : {
        message: {
          subject: message.subject || "Message from Allied Radar",
          body: { contentType: "Text", content: message.content },
          toRecipients: [
            { emailAddress: { address: message.destination } },
          ],
          ...(message.cc?.length ? { ccRecipients: recipients(message.cc) } : {}),
          ...(message.bcc?.length ? { bccRecipients: recipients(message.bcc) } : {}),
          ...(message.internetMessageHeaders?.length
            ? { internetMessageHeaders: message.internetMessageHeaders }
            : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((attachment) => ({
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: attachment.name,
                  contentType: attachment.contentType,
                  contentBytes: attachment.contentBytes,
                })),
              }
            : {}),
        },
        saveToSentItems: true,
      };

  const response = await fetch(replyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "client-request-id": message.clientRequestId,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) await providerFailure(response, "Outlook");

  return {
    provider: "Outlook",
    state: "accepted",
    detail: "Outlook accepted the message for delivery and saved it to Sent Items.",
  };
}

async function sendTeams(message: OutboundMessage, token: string): Promise<SendResult> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(message.destination)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "client-request-id": message.clientRequestId,
      },
      body: JSON.stringify({ body: { content: message.content } }),
    },
  );

  if (!response.ok) await providerFailure(response, "Teams");
  const payload = (await response.json().catch(() => ({}))) as { id?: string };

  return {
    provider: "Teams",
    state: "sent",
    providerMessageId: payload.id,
    detail: "The message was posted to the selected Teams chat.",
  };
}

async function odooRpc(service: string, method: string, args: unknown[]) {
  const url = process.env.ODOO_URL!.replace(/\/$/, "");
  const response = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: crypto.randomUUID(),
    }),
  });

  if (!response.ok) await providerFailure(response, "Odoo Discuss");
  const payload = (await response.json()) as {
    result?: unknown;
    error?: { data?: { message?: string }; message?: string };
  };
  if (payload.error) {
    throw new MessagingError(
      "provider_rejected",
      `Odoo Discuss rejected the message: ${payload.error.data?.message ?? payload.error.message ?? "Unknown error"}`,
      502,
    );
  }
  return payload.result;
}

async function sendOdoo(message: OutboundMessage): Promise<SendResult> {
  const database = process.env.ODOO_DATABASE!;
  const username = process.env.ODOO_USERNAME!;
  const apiKey = process.env.ODOO_API_KEY!;
  const uid = await odooRpc("common", "authenticate", [
    database,
    username,
    apiKey,
    {},
  ]);

  if (typeof uid !== "number" || uid <= 0) {
    throw new MessagingError(
      "provider_auth_failed",
      "Odoo authentication failed",
      401,
    );
  }

  const channelId = Number(message.destination);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    throw new MessagingError(
      "invalid_destination",
      "Odoo Discuss needs a numeric channel ID",
    );
  }

  const { model, channelIds } = odooDiscussScope();
  if (!channelIds.includes(channelId)) {
    throw new MessagingError(
      "destination_not_allowed",
      "This Odoo Discuss channel is not in the approved server-side allowlist.",
      403,
    );
  }

  const escapedBody = message.content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
  const result = await odooRpc("object", "execute_kw", [
    database,
    uid,
    apiKey,
    model,
    "message_post",
    [[channelId]],
    {
      body: escapedBody,
      message_type: "comment",
      subtype_xmlid: "mail.mt_comment",
    },
  ]);

  return {
    provider: "Odoo Discuss",
    state: "sent",
    providerMessageId:
      typeof result === "number" ? String(result) : undefined,
    detail: "The message was posted to the selected Odoo Discuss channel.",
  };
}

async function sendWhatsApp(message: OutboundMessage): Promise<SendResult> {
  const phone = message.destination.replace(/[^0-9]/g, "");
  if (!phone) {
    throw new MessagingError(
      "invalid_destination",
      "WhatsApp needs an international phone number",
    );
  }
  return {
    provider: "WhatsApp",
    state: "handoff",
    handoffUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message.content)}`,
    detail: "WhatsApp is ready with the reviewed recipient and message. Press Send there to deliver it.",
  };
}

export async function sendMessage(
  message: OutboundMessage,
  userId: string,
): Promise<SendResult> {
  if (message.provider === "Odoo Discuss" || message.provider === "WhatsApp") {
    requireProvider(message.provider);
  }

  switch (message.provider) {
    case "Outlook":
      return sendOutlook(message, await graphAccessToken(userId, "outlook"));
    case "Teams":
      return sendTeams(message, await graphAccessToken(userId, "teams"));
    case "Odoo Discuss":
      return sendOdoo(message);
    case "WhatsApp":
      return sendWhatsApp(message);
  }
}
