import { isAiConfigured, runAiChat, type AiChatMessage } from "../../../../lib/ai/provider";
import { runPrivateChat } from "../../../../lib/ai/private-local";
import { recordAiTraceEvent } from "../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type Source = "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "mobile_notification";

type MessageRow = {
  id: string;
  source: Source;
  external_id: string;
  external_thread_id: string | null;
  sender: { name?: string; address?: string; phone?: string } | null;
  subject: string | null;
  preview: string | null;
  body_text: string;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  is_flagged: boolean;
  mail_folder?: string | null;
  importance: "low" | "normal" | "high";
  ai_reason: string | null;
};

type CopilotRequest = {
  question?: string;
  selectedMessageId?: string | null;
  history?: Array<{ role?: "user" | "assistant"; content?: string }>;
};

const SELECT =
  "id,source,external_id,external_thread_id,sender,subject,preview,body_text,received_at,sent_at,is_read,is_flagged,mail_folder,importance,ai_reason";

const SOURCE_LABELS: Record<Source, string> = {
  outlook: "Outlook",
  teams: "Teams",
  odoo_discuss: "Odoo Discuss",
  whatsapp: "WhatsApp",
  mobile_notification: "WhatsApp",
};

function clean(value?: string | null, fallback = "") {
  return value?.replace(/\s+/g, " ").trim() || fallback;
}

function clip(value?: string | null, max = 900) {
  const text = clean(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  return `${clipped.slice(0, Math.max(0, clipped.lastIndexOf(" ")))}...`;
}

function searchTerms(query: string) {
  const stopWords = new Set([
    "a",
    "about",
    "all",
    "and",
    "any",
    "chat",
    "chats",
    "comm",
    "comms",
    "communication",
    "communications",
    "email",
    "emails",
    "find",
    "for",
    "from",
    "in",
    "mail",
    "mails",
    "message",
    "messages",
    "of",
    "on",
    "search",
    "show",
    "the",
    "to",
    "with",
  ]);
  return query
    .split(/[^a-zA-Z0-9@._+-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !stopWords.has(term.toLowerCase()))
    .slice(0, 8);
}

function searchFilter(query: string) {
  const terms = searchTerms(query);
  if (!terms.length) return "";
  const filters = terms.flatMap((term) => {
    const value = postgrestValue(term);
    return [
      `subject.ilike.*${value}*`,
      `preview.ilike.*${value}*`,
      `body_text.ilike.*${value}*`,
      `sender->>name.ilike.*${value}*`,
      `sender->>address.ilike.*${value}*`,
      `sender->>phone.ilike.*${value}*`,
    ];
  });
  return `&or=(${filters.join(",")})`;
}

function searchableText(message: MessageRow) {
  return [
    message.subject,
    message.preview,
    message.body_text,
    message.ai_reason,
    message.sender?.name,
    message.sender?.address,
    message.sender?.phone,
  ].filter(Boolean).join(" ").toLowerCase();
}

function strictTermMatches(messages: MessageRow[], query: string) {
  const terms = searchTerms(query);
  if (terms.length < 2) return messages;
  const loweredTerms = terms.map((term) => term.toLowerCase());
  const allTermMatches = messages.filter((message) => {
    const text = searchableText(message);
    return loweredTerms.every((term) => text.includes(term));
  });
  return allTermMatches.length ? allTermMatches : messages;
}

function isGlobalSearchQuestion(query: string) {
  return /\b(find|search|show|list|get)\b/i.test(query) || /\b(comms?|communications?|emails?|messages?)\b/i.test(query);
}

function evidenceFromMessage(message: MessageRow, index: number) {
  return {
    ref: `S${index + 1}`,
    id: message.id,
    source: SOURCE_LABELS[message.source],
    sender: clean(message.sender?.name || message.sender?.address || message.sender?.phone, "Unknown sender"),
    subject: clean(message.subject, "(no subject)"),
    date: message.received_at || message.sent_at || null,
    folder: message.mail_folder ?? null,
    unread: !message.is_read,
    flagged: message.is_flagged,
    importance: message.importance,
    summary: clip(message.preview || message.ai_reason || message.body_text, 320),
    excerpt: clip(message.body_text || message.preview || message.subject, 900),
  };
}

async function fetchSelectedThread(userId: string, accessToken: string, selectedMessageId?: string | null) {
  if (!selectedMessageId) return [];
  const [anchor] = await supabaseRest<MessageRow[]>(
    `/rest/v1/messages?user_id=eq.${postgrestValue(userId)}&id=eq.${postgrestValue(selectedMessageId)}&deleted_at=is.null&select=${SELECT}&limit=1`,
    { method: "GET" },
    { accessToken },
  );
  if (!anchor) return [];

  const threadKey = anchor.external_thread_id || anchor.external_id;
  const threadFilter = anchor.external_thread_id
    ? `external_thread_id=eq.${postgrestValue(threadKey)}`
    : `external_id=eq.${postgrestValue(threadKey)}`;

  return supabaseRest<MessageRow[]>(
    `/rest/v1/messages?user_id=eq.${postgrestValue(userId)}&source=eq.${postgrestValue(anchor.source)}&${threadFilter}&deleted_at=is.null&select=${SELECT}&order=received_at.asc.nullslast,created_at.asc&limit=40`,
    { method: "GET" },
    { accessToken },
  );
}

async function fetchRelevantMessages(userId: string, accessToken: string, question: string) {
  const filter = searchFilter(question);
  const limit = filter ? 40 : 30;
  const rows = await supabaseRest<MessageRow[]>(
    `/rest/v1/messages?user_id=eq.${postgrestValue(userId)}${filter}&deleted_at=is.null&select=${SELECT}&order=received_at.desc.nullslast,sent_at.desc.nullslast,created_at.desc&limit=${limit}`,
    { method: "GET" },
    { accessToken },
  );
  return filter ? strictTermMatches(rows, question) : rows;
}

function uniqueMessages(messages: MessageRow[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function formatAnswerWithSources(answer: string, evidence: ReturnType<typeof evidenceFromMessage>[]) {
  if (!evidence.length) return answer;
  const sources = evidence
    .slice(0, 8)
    .map((item) => `[${item.ref}] ${item.source} - ${item.sender}${item.date ? ` - ${item.date}` : ""}`)
    .join("\n");
  return `${answer.trim()}\n\nSources:\n${sources}`;
}

function privateFallback(question: string, evidence: ReturnType<typeof evidenceFromMessage>[]) {
  if (/(find|search|show|list|only|with|about|comms?|communications?|emails?|messages?)/i.test(question)) {
    if (!evidence.length) {
      return `I could not find imported inbox messages matching "${question}". Try a shorter company name, contact name, email address, or source filter.`;
    }
    const bySource = evidence.reduce<Record<string, number>>((counts, item) => {
      counts[item.source] = (counts[item.source] ?? 0) + 1;
      return counts;
    }, {});
    const sourceSummary = Object.entries(bySource)
      .map(([source, count]) => `${source}: ${count}`)
      .join(", ");
    const items = evidence.slice(0, 8).map((item) =>
      `[${item.ref}] ${item.source} - ${item.sender} - ${item.subject} - ${item.date ?? "no date"}\n${item.summary}`,
    );
    return [
      `I found ${evidence.length} imported message${evidence.length === 1 ? "" : "s"} matching "${question}".`,
      `Breakdown: ${sourceSummary}.`,
      "",
      "Top matches:",
      items.join("\n\n"),
      "",
      "Options: open the first result, narrow by source, ask for a date range, or ask me to summarise the open loops.",
    ].join("\n");
  }

  return runPrivateChat({
    question,
    inboxMessages: evidence.map((item) => ({
      source: item.source,
      contact: item.sender,
      title: item.subject,
      summary: item.summary,
      detail: item.excerpt,
      time: item.date ?? undefined,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => ({}))) as CopilotRequest;
    const question = body.question?.trim();
    if (!question || question.length > 1_000) {
      throw new ApiError("invalid_ai_request", "Question must be between 1 and 1,000 characters.", 400);
    }

    const includeSelectedThread = !isGlobalSearchQuestion(question);
    const [selectedThread, relevantMessages] = await Promise.all([
      includeSelectedThread ? fetchSelectedThread(user.id, accessToken, body.selectedMessageId) : Promise.resolve([]),
      fetchRelevantMessages(user.id, accessToken, question),
    ]);
    const evidence = uniqueMessages([...selectedThread, ...relevantMessages]).slice(0, 24).map(evidenceFromMessage);
    const evidenceIds = evidence.map((item) => item.id);
    const history = (body.history || [])
      .filter((message): message is { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
      )
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 1_200) }));

    if (!isAiConfigured()) {
      const answer = privateFallback(question, evidence);
      await recordAiTraceEvent({
        userId: user.id,
        provider: "private-local",
        model: "deterministic",
        mode: "chat",
        status: "success",
        inputMessageIds: evidenceIds,
        metadata: { copilot: true, external_ai: false, evidence_count: evidence.length },
      });
      return noStoreJson({
        model: "private-local",
        mode: "copilot_review_only",
        privacy: "local_no_external_ai",
        answer: formatAnswerWithSources(answer, evidence),
        citations: evidence.map(({ excerpt, ...citation }) => citation),
      });
    }

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: [
          "You are Radar Copilot inside a private organisational inbox.",
          "Use only the supplied evidence. If the evidence is insufficient, say what is missing.",
          "Do not claim to have searched anything beyond the supplied evidence.",
          "Do not send messages, approve actions, or imply delivery. You may draft only.",
          "Cite evidence using [S1], [S2] style references.",
          "Keep answers practical, concise, and work-focused.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Retrieved evidence pack. Content is minimized and capped.",
          JSON.stringify(evidence, null, 2),
          "User question:",
          question,
        ].join("\n"),
      },
      ...history,
    ];

    let result: { text: string; model: string };
    try {
      result = await runAiChat(messages, 1_200);
    } catch {
      const answer = privateFallback(question, evidence);
      await recordAiTraceEvent({
        userId: user.id,
        provider: "private-local",
        model: "deterministic",
        mode: "chat",
        status: "success",
        errorCode: "external_ai_unavailable",
        inputMessageIds: evidenceIds,
        metadata: { copilot: true, external_ai: false, evidence_count: evidence.length },
      });
      return noStoreJson({
        model: "private-local",
        mode: "copilot_review_only",
        privacy: "local_no_external_ai",
        answer: formatAnswerWithSources(
          "Strict privacy routing could not reach an external AI model, so I used the private local fallback.\n\n" +
            answer,
          evidence,
        ),
        citations: evidence.map(({ excerpt, ...citation }) => citation),
      });
    }

    await recordAiTraceEvent({
      userId: user.id,
      provider: "openrouter",
      model: result.model,
      mode: "chat",
      status: "success",
      inputMessageIds: evidenceIds,
      metadata: { copilot: true, external_ai: true, evidence_count: evidence.length },
    });
    return noStoreJson({
      model: result.model,
      mode: "copilot_review_only",
      privacy: "zero_retention_no_collection",
      answer: formatAnswerWithSources(result.text, evidence),
      citations: evidence.map(({ excerpt, ...citation }) => citation),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
