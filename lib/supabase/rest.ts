import {
  requireSupabaseAnonKey,
  requireSupabaseServiceRoleKey,
  requireSupabaseUrl,
} from "../security/config";
import { ApiError } from "../security/errors";

type SupabaseAuth =
  | { accessToken: string; serviceRole?: false }
  | { serviceRole: true; accessToken?: never };

type JsonBody = Record<string, unknown> | Record<string, unknown>[];

export class SupabaseRestError extends ApiError {
  constructor(status: number, detail?: string) {
    super(
      "supabase_rest_error",
      detail ? `Database request failed: ${detail}` : "Database request failed.",
      status >= 400 ? status : 502,
    );
    this.name = "SupabaseRestError";
  }
}

export function postgrestValue(value: string) {
  return encodeURIComponent(value);
}

function isModernSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

export async function supabaseRest<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: JsonBody | string } = {},
  auth: SupabaseAuth,
): Promise<T> {
  const baseUrl = requireSupabaseUrl();
  const endpoint = new URL(path, `${baseUrl}/`);
  const key = auth.serviceRole ? requireSupabaseServiceRoleKey() : requireSupabaseAnonKey();
  const headers = new Headers(init.headers);

  headers.set("apikey", key);
  if (auth.serviceRole) {
    if (isModernSupabaseSecretKey(key)) {
      headers.delete("authorization");
    } else {
      headers.set("authorization", `Bearer ${key}`);
    }
  } else {
    headers.set("authorization", `Bearer ${auth.accessToken}`);
  }
  headers.set("accept", "application/json");

  let body: BodyInit | undefined;
  if (typeof init.body === "string") {
    body = init.body;
  } else if (init.body) {
    body = JSON.stringify(init.body);
  }

  if (body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      body,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new SupabaseRestError(503);
  }

  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? String(
            (payload as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }).message ??
              (payload as { details?: unknown }).details ??
              (payload as { hint?: unknown }).hint ??
              (payload as { code?: unknown }).code ??
              "",
          )
        : "";
    throw new SupabaseRestError(response.status, detail || undefined);
  }

  return payload as T;
}
