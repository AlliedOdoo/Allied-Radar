import { supabaseRest } from "../supabase/rest";

export type NormalizedMessage = {
  user_id: string;
  connection_id?: string | null;
  source: "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "mobile_notification";
  source_type: "email" | "chat" | "channel" | "discuss" | "whatsapp" | "mobile_notification";
  external_id: string;
  external_thread_id?: string | null;
  folder_or_channel_id?: string | null;
  folder_or_channel_name?: string | null;
  mail_folder?: string;
  provider_state?: Record<string, unknown>;
  sender?: Record<string, unknown>;
  recipients?: Record<string, unknown>[];
  subject?: string | null;
  body_text?: string;
  preview?: string | null;
  sent_at?: string | null;
  received_at?: string | null;
  external_updated_at?: string | null;
  is_read?: boolean;
  is_flagged?: boolean;
  importance?: "low" | "normal" | "high";
  has_attachments?: boolean;
  attachments?: Record<string, unknown>[];
  source_permalink?: string | null;
};

export function plainText(value: unknown, maxLength = 20_000) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export async function upsertNormalizedMessages(messages: NormalizedMessage[]) {
  if (!messages.length) return [];
  const rows = messages.map((message) => ({
    user_id: message.user_id,
    connection_id: message.connection_id ?? null,
    source: message.source,
    source_type: message.source_type,
    external_id: message.external_id,
    external_thread_id: message.external_thread_id ?? null,
    parent_external_id: null,
    folder_or_channel_id: message.folder_or_channel_id ?? null,
    folder_or_channel_name: message.folder_or_channel_name ?? null,
    mail_folder: message.mail_folder ?? "inbox",
    provider_state: message.provider_state ?? {},
    sender: message.sender ?? {},
    recipients: message.recipients ?? [],
    participants: [],
    mentions: [],
    subject: message.subject ?? null,
    body_text: message.body_text ?? "",
    body_html_sanitized: null,
    preview: message.preview ?? null,
    sent_at: message.sent_at ?? null,
    received_at: message.received_at ?? null,
    external_updated_at: message.external_updated_at ?? null,
    deleted_at: null,
    is_read: message.is_read ?? false,
    is_flagged: message.is_flagged ?? false,
    importance: message.importance ?? "normal",
    has_attachments: message.has_attachments ?? false,
    attachments: message.attachments ?? [],
    source_permalink: message.source_permalink ?? null,
    raw_payload: null,
    raw_payload_ref: null,
    ai_summary: null,
    ai_priority_score: null,
    ai_reason: null,
    topics: [],
  }));
  return supabaseRest<Array<{ id: string; source: string; external_id: string }>>(
    "/rest/v1/messages?on_conflict=user_id,source,external_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: rows,
    },
    { serviceRole: true },
  );
}
