import { isAiConfigured, parseJsonObject, runAiChat } from "../../../../lib/ai/provider";
import { runPrivateSearch } from "../../../../lib/ai/private-local";
import { DRAFT_ONLY_SYSTEM_PROMPT } from "../../../../lib/guardrails";
import { recordAiTraceEvent } from "../../../../lib/ops/logging";
import { requireSupabaseUser } from "../../../../lib/security/auth";
import { ApiError } from "../../../../lib/security/errors";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";

type SearchRequest = { query?: string };

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const body = (await request.json().catch(() => ({}))) as SearchRequest;
    const query = body.query?.trim();
    if (!query || query.length > 500) {
      throw new ApiError(
        "invalid_ai_request",
        "Search query must be between 1 and 500 characters.",
        400,
      );
    }
    if (!isAiConfigured()) {
      await recordAiTraceEvent({ userId: user.id, provider: "private-local", model: "deterministic", mode: "search", status: "success" });
      return noStoreJson({
        model: "private-local",
        mode: "search_assist",
        privacy: "local_no_external_ai",
        result: runPrivateSearch(query),
      });
    }

    let result: { text: string; model: string };
    try {
      result = await runAiChat([
      {
        role: "system",
        content: `${DRAFT_ONLY_SYSTEM_PROMPT}\nFor search assistance, return only valid JSON with expandedQuery, likelyPeople, topics, and filters.`,
      },
      { role: "user", content: `Expand this unified inbox search query: ${query}` },
      ], 500);
    } catch {
      await recordAiTraceEvent({ userId: user.id, provider: "private-local", model: "deterministic", mode: "search", status: "success", errorCode: "external_ai_unavailable" });
      return noStoreJson({
        model: "private-local",
        mode: "search_assist",
        privacy: "local_no_external_ai",
        result: runPrivateSearch(query),
      });
    }
    await recordAiTraceEvent({ userId: user.id, provider: "openrouter", model: result.model, mode: "search", status: "success" });
    return noStoreJson({
      model: result.model,
      mode: "search_assist",
      privacy: "zero_retention_no_collection",
      result: parseJsonObject(result.text),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
