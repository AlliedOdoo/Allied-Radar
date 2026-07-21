import { isAiConfigured, runAiChat } from "../../../../lib/ai/provider";
import { runPrivateDraft } from "../../../../lib/ai/private-local";
import { DRAFT_ONLY_SYSTEM_PROMPT } from "../../../../lib/guardrails";
import { recordAiTraceEvent } from "../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";

type DraftRequest = {
  message?: string;
  tone?: "warm" | "firm" | "short" | "detailed";
  context?: string;
  instruction?: string;
};

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => ({}))) as DraftRequest;
    const sourceMessage = body.message?.trim();
    if (!sourceMessage || sourceMessage.length > 12_000) {
      throw new ApiError(
        "invalid_ai_request",
        "Message must be between 1 and 12,000 characters.",
        400,
      );
    }
    if ((body.context?.length ?? 0) > 8_000 || (body.instruction?.length ?? 0) > 1_000) {
      throw new ApiError("invalid_ai_request", "Draft context is too large.", 400);
    }
    if (!isAiConfigured()) {
      const draft = runPrivateDraft({
        message: sourceMessage,
        tone: body.tone,
        instruction: body.instruction,
        context: body.context,
      });
      await recordAiTraceEvent({ userId: user.id, provider: "private-local", model: "deterministic", mode: "draft", status: "success" });
      return noStoreJson({
        model: "private-local",
        mode: "draft_only",
        privacy: "local_no_external_ai",
        draft,
      });
    }

    let result: { text: string; model: string };
    try {
      result = await runAiChat([
      { role: "system", content: DRAFT_ONLY_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Draft a reply to the message below.",
          `Tone: ${body.tone ?? "warm"}.`,
          body.instruction ? `Editing instruction: ${body.instruction}` : "",
          body.context ? `Context: ${body.context}` : "",
          `Message: ${sourceMessage}`,
          "Return only the editable draft. Never claim it was sent.",
        ].filter(Boolean).join("\n"),
      },
      ]);
    } catch {
      const draft = runPrivateDraft({
        message: sourceMessage,
        tone: body.tone,
        instruction: body.instruction,
        context: body.context,
      });
      await recordAiTraceEvent({ userId: user.id, provider: "private-local", model: "deterministic", mode: "draft", status: "success", errorCode: "external_ai_unavailable" });
      return noStoreJson({
        model: "private-local",
        mode: "draft_only",
        privacy: "local_no_external_ai",
        draft,
      });
    }
    await recordAiTraceEvent({ userId: user.id, provider: "openrouter", model: result.model, mode: "draft", status: "success" });
    return noStoreJson({
      model: result.model,
      mode: "draft_only",
      privacy: "zero_retention_no_collection",
      draft: result.text,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
