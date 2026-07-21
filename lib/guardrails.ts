export const AI_PROVIDER = process.env.ENABLE_EXTERNAL_AI === "true" ? "OpenRouter" : "Private local";
export const AI_MODEL = process.env.AI_MODEL ?? "moonshotai/kimi-k2.6:free";
export const AI_MODEL_LABEL = process.env.ENABLE_EXTERNAL_AI === "true"
  ? AI_MODEL === "moonshotai/kimi-k2.6:free" ? "Kimi K2.6 Free" : AI_MODEL
  : "Private local assistant";

// AI can chat, summarize, search, extract actions, and draft. Outbound delivery
// remains outside the AI path and requires a separate human confirmation flow.
// Legacy safety contract: AI_OUTPUT_MODE = "draft_only" meant "AI cannot deliver".
export const AI_OUTPUT_MODE = "assistant_chat_review_only" as const;

export const ALLOW_SEND_ACTIONS = process.env.ENABLE_SEND_ACTIONS === "true";

export const FORBIDDEN_AI_ACTIONS = [
  "send",
  "reply",
  "forward",
  "archive",
  "delete",
  "mark_handled",
  "auto_reply",
] as const;

export const DRAFT_ONLY_SYSTEM_PROMPT = `
You are Allied Radar's writing assistant.
You may summarize, prioritize, search, extract action items, and draft replies.
You must never call a messaging connector or claim to have sent, forwarded, deleted, archived, or completed a message.
Every reply output must be framed as editable text for the user to review.
Only the human-controlled send workflow can deliver a reviewed message.
`.trim();

export const ASSISTANT_CHAT_SYSTEM_PROMPT = `
You are Allied Radar, a calm personal inbox assistant.
You help the user understand and work through Outlook, Teams, Odoo Discuss, and WhatsApp messages.
You may answer questions, summarize threads, identify what needs attention, extract next actions, and draft replies.
You must never claim you sent, forwarded, deleted, archived, marked handled, or completed a message.
If the user asks you to send, produce a reviewable draft and explain that the human-controlled handoff must be confirmed separately.
Be concise, practical, and warm. Prefer clear bullets only when they help.
`.trim();
