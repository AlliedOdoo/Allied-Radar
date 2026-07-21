import { ApiError } from "../security/errors";

type OdooEnvelope<T> = {
  result?: T;
  error?: { message?: string; data?: { message?: string } };
};

export function isOdooConfigured() {
  return [
    process.env.ODOO_URL,
    process.env.ODOO_DATABASE,
    process.env.ODOO_USERNAME,
    process.env.ODOO_API_KEY,
    process.env.ODOO_PARTNER_ID,
  ].every((value) => Boolean(value?.trim()));
}

export function odooInboxPartnerId() {
  const partnerId = Number(process.env.ODOO_PARTNER_ID?.trim());
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new ApiError(
      "odoo_partner_not_configured",
      "Odoo inbox partner ID is not configured.",
      503,
    );
  }
  return partnerId;
}

export function odooDiscussScope() {
  return {
    model: process.env.ODOO_DISCUSS_MODEL?.trim() || "discuss.channel",
    channelIds: (process.env.ODOO_DISCUSS_CHANNEL_IDS ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  };
}

export function requireOdooDiscussScope() {
  const scope = odooDiscussScope();
  if (!scope.channelIds.length) {
    throw new ApiError(
      "odoo_scope_not_configured",
      "Odoo Discuss sending needs approved channel IDs before outbound messages are allowed.",
      503,
    );
  }
  return scope;
}

export function odooJsonRpcEndpoint() {
  const rawUrl = process.env.ODOO_URL?.trim();
  if (!rawUrl) {
    throw new ApiError("odoo_not_configured", "Odoo connection details are incomplete.", 503);
  }
  const url = new URL(rawUrl);
  return `${url.origin}/jsonrpc`;
}

export async function odooRpc<T>(service: string, method: string, args: unknown[]) {
  const endpoint = odooJsonRpcEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: crypto.randomUUID(),
    }),
  });
  const payload = (await response.json().catch(() => null)) as OdooEnvelope<T> | null;
  if (!response.ok || payload?.error || payload?.result === undefined) {
    const detail =
      payload?.error?.data?.message ||
      payload?.error?.message ||
      `Odoo ${service}.${method} failed with HTTP ${response.status}.`;
    throw new ApiError("odoo_request_failed", detail, 502);
  }
  return payload.result;
}

export async function odooAuthenticate() {
  if (!isOdooConfigured()) {
    throw new ApiError("odoo_not_configured", "Odoo connection details are incomplete.", 503);
  }
  const uid = await odooRpc<number | false>("common", "authenticate", [
    process.env.ODOO_DATABASE,
    process.env.ODOO_USERNAME,
    process.env.ODOO_API_KEY,
    {},
  ]);
  if (typeof uid !== "number" || uid <= 0) {
    throw new ApiError("odoo_auth_failed", "Odoo authentication failed.", 401);
  }
  return uid;
}
