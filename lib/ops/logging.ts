import { postgrestValue, supabaseRest } from "../supabase/rest";

type ConnectorRunRow = { id: string };

export async function startConnectorRun(input: {
  userId: string;
  provider: "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "all";
  trigger?: string;
  metadata?: Record<string, unknown>;
}) {
  const rows = await supabaseRest<ConnectorRunRow[]>(
    "/rest/v1/connector_runs",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: input.userId,
        provider: input.provider,
        trigger: input.trigger ?? "manual",
        status: "started",
        metadata: input.metadata ?? {},
      },
    },
    { serviceRole: true },
  );
  return rows[0]?.id ?? null;
}

export async function finishConnectorRun(input: {
  id: string | null;
  userId: string;
  status: "success" | "partial" | "failed";
  fetchedCount?: number;
  storedCount?: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.id) return;
  await supabaseRest<unknown>(
    `/rest/v1/connector_runs?id=eq.${postgrestValue(input.id)}&user_id=eq.${postgrestValue(input.userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        status: input.status,
        finished_at: new Date().toISOString(),
        fetched_count: input.fetchedCount ?? 0,
        stored_count: input.storedCount ?? 0,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage?.slice(0, 500) ?? null,
        metadata: input.metadata ?? {},
      },
    },
    { serviceRole: true },
  );
}

export async function recordErrorEvent(input: {
  userId?: string | null;
  source: string;
  severity?: "info" | "warn" | "error" | "critical";
  code?: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRest<unknown>(
    "/rest/v1/error_events",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        user_id: input.userId ?? null,
        source: input.source,
        severity: input.severity ?? "error",
        code: input.code?.slice(0, 120) ?? null,
        message: input.message.slice(0, 1000),
        metadata: input.metadata ?? {},
      },
    },
    { serviceRole: true },
  );
}

export async function recordAiTraceEvent(input: {
  userId?: string | null;
  provider?: string;
  model?: string;
  mode: "search" | "summary" | "draft" | "chat";
  status: "blocked" | "started" | "success" | "failed";
  inputMessageIds?: string[];
  inputHash?: string;
  outputHash?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRest<unknown>(
    "/rest/v1/ai_trace_events",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        user_id: input.userId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        mode: input.mode,
        status: input.status,
        input_message_ids: input.inputMessageIds ?? [],
        input_hash: input.inputHash ?? null,
        output_hash: input.outputHash ?? null,
        error_code: input.errorCode ?? null,
        metadata: input.metadata ?? {},
      },
    },
    { serviceRole: true },
  );
}
