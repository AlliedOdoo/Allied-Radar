import { AI_MODEL } from "../guardrails";
import { ApiError } from "../security/errors";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function isAiConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export const AI_PRIVACY_POLICY = {
  data_collection: "deny",
  zdr: true,
} as const;

export async function runAiChat(messages: AiChatMessage[], maxTokens = 900) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("AI provider is not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Allied Radar",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      provider: AI_PRIVACY_POLICY,
    }),
  });
  if (!response.ok) {
    throw new ApiError(
      "private_ai_unavailable",
      "No privacy-compliant AI endpoint is currently available. No draft data was accepted for processing.",
      503,
    );
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI provider returned an empty response");
  return { text, model: payload.model || AI_MODEL };
}

export function parseJsonObject(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}
