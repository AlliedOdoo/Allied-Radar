import { isAiConfigured, runAiChat, type AiChatMessage } from "../../../../lib/ai/provider";
import { runPrivateChat } from "../../../../lib/ai/private-local";
import { ASSISTANT_CHAT_SYSTEM_PROMPT } from "../../../../lib/guardrails";
import { recordAiTraceEvent } from "../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";

type InboxContextMessage = {
  id?: string;
  source?: string;
  contact?: string;
  title?: string;
  summary?: string;
  detail?: string;
  reason?: string;
  status?: string;
  displayDate?: string;
  displayTime?: string;
};

type ChatRequest = {
  question?: string;
  selectedMessage?: InboxContextMessage;
  inboxMessages?: InboxContextMessage[];
  history?: Array<{ role?: "user" | "assistant"; content?: string }>;
};

function compactMessage(message: InboxContextMessage) {
  return {
    source: message.source,
    contact: message.contact,
    title: message.title,
    summary: message.summary,
    detail: message.detail?.slice(0, 2_000),
    reason: message.reason,
    status: message.status,
    time: [message.displayDate, message.displayTime].filter(Boolean).join(" "),
  };
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => ({}))) as ChatRequest;
    const question = body.question?.trim();
    if (!question || question.length > 1_000) {
      throw new ApiError("invalid_ai_request", "Question must be between 1 and 1,000 characters.", 400);
    }
    const inboxMessages = (body.inboxMessages || []).slice(0, 20).map(compactMessage);
    const selectedMessage = body.selectedMessage ? compactMessage(body.selectedMessage) : null;
    const history = (body.history || [])
      .filter((message): message is { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
      )
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }));

    if (!isAiConfigured()) {
      await recordAiTraceEvent({
        userId: user.id,
        provider: "private-local",
        model: "deterministic",
        mode: "chat",
        status: "success",
        inputMessageIds: body.selectedMessage?.id ? [body.selectedMessage.id] : [],
      });
      return noStoreJson({
        model: "private-local",
        mode: "assistant_chat_review_only",
        privacy: "local_no_external_ai",
        answer: runPrivateChat({ question, selectedMessage, inboxMessages }),
      });
    }

    const messages: AiChatMessage[] = [
      { role: "system", content: ASSISTANT_CHAT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Current selected message:",
          JSON.stringify(selectedMessage, null, 2),
          "Visible inbox context:",
          JSON.stringify(inboxMessages, null, 2),
          "Answer the user's next question using only this context. If more data is needed, say what is missing.",
        ].join("\n"),
      },
      ...history,
      { role: "user", content: question },
    ];

    let result: { text: string; model: string };
    try {
      result = await runAiChat(messages, 900);
    } catch {
      await recordAiTraceEvent({
        userId: user.id,
        provider: "private-local",
        model: "deterministic",
        mode: "chat",
        status: "success",
        errorCode: "external_ai_unavailable",
        inputMessageIds: body.selectedMessage?.id ? [body.selectedMessage.id] : [],
      });
      return noStoreJson({
        model: "private-local",
        mode: "assistant_chat_review_only",
        privacy: "local_no_external_ai",
        answer: runPrivateChat({ question, selectedMessage, inboxMessages }),
      });
    }
    await recordAiTraceEvent({
      userId: user.id,
      provider: "openrouter",
      model: result.model,
      mode: "chat",
      status: "success",
      inputMessageIds: body.selectedMessage?.id ? [body.selectedMessage.id] : [],
    });
    return noStoreJson({
      model: result.model,
      mode: "assistant_chat_review_only",
      privacy: "zero_retention_no_collection",
      answer: result.text,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
