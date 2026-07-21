import { requireSupabaseUser } from "../../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type ConnectionRow = {
  provider: "outlook" | "teams" | "odoo_discuss" | "whatsapp";
  status: string;
  last_sync_at: string | null;
  last_error_code?: string | null;
  last_error_at?: string | null;
};

type DeviceRow = { id: string; is_active: boolean; last_seen_at: string | null };
type ConnectorRunRow = {
  provider: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  fetched_count: number;
  stored_count: number;
  error_code: string | null;
  error_message: string | null;
};
type ErrorRow = { source: string; code: string | null; message: string; created_at: string };

function has(...values: Array<string | undefined>) {
  return values.every((value) => Boolean(value?.trim()));
}

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const [connections, devices, runs, recentErrors] = await Promise.all([
      supabaseRest<ConnectionRow[]>(
        `/rest/v1/connections?user_id=eq.${postgrestValue(user.id)}&select=provider,status,last_sync_at,last_error_code,last_error_at`,
        { method: "GET" },
        { accessToken },
      ),
      supabaseRest<DeviceRow[]>(
        `/rest/v1/devices?user_id=eq.${postgrestValue(user.id)}&is_active=eq.true&select=id,is_active,last_seen_at`,
        { method: "GET" },
        { accessToken },
      ),
      supabaseRest<ConnectorRunRow[]>(
        `/rest/v1/connector_runs?user_id=eq.${postgrestValue(user.id)}&select=provider,status,started_at,finished_at,fetched_count,stored_count,error_code,error_message&order=started_at.desc&limit=12`,
        { method: "GET" },
        { accessToken },
      ),
      supabaseRest<ErrorRow[]>(
        `/rest/v1/error_events?or=(user_id.eq.${postgrestValue(user.id)},user_id.is.null)&select=source,code,message,created_at&order=created_at.desc&limit=8`,
        { method: "GET" },
        { accessToken },
      ),
    ]);
    const byProvider = new Map(connections.map((row) => [row.provider, row]));
    const outlook = byProvider.get("outlook");
    const teams = byProvider.get("teams");
    const odoo = byProvider.get("odoo_discuss");

    const microsoftConfigured = has(
      process.env.MICROSOFT_CLIENT_ID,
      process.env.MICROSOFT_TENANT_ID,
    );
    const odooConfigured = has(
      process.env.ODOO_URL,
      process.env.ODOO_DATABASE,
      process.env.ODOO_USERNAME,
      process.env.ODOO_API_KEY,
    );
    const mobileServerConfigured = has(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.DEVICE_TOKEN_PEPPER,
    );

    const connectors = [
      {
        id: "supabase",
        label: "Supabase",
        configured: true,
        connected: true,
        detail: "Private session and database are available.",
      },
      {
        id: "microsoft",
        label: "Microsoft 365",
        configured: microsoftConfigured,
        connected: outlook?.status === "connected" && teams?.status === "connected",
        detail:
          outlook?.status === "connected" && teams?.status === "connected"
            ? "Outlook and Teams delegated access is connected."
            : microsoftConfigured
              ? "Registration found. Complete Microsoft sign-in."
              : "Microsoft registration is incomplete.",
      },
      {
        id: "odoo",
        label: "Odoo 18",
        configured: odooConfigured,
        connected: odoo?.status === "connected",
        detail: odooConfigured
          ? odoo?.status === "connected"
            ? "Odoo Discuss is connected."
            : "Credentials found. A read-only connection test is next."
          : "Odoo connection details are incomplete.",
      },
      {
        id: "whatsapp",
        label: "WhatsApp companion",
        configured: mobileServerConfigured,
        connected: devices.length > 0,
        detail: devices.length
          ? `${devices.length} Android device${devices.length === 1 ? "" : "s"} paired.`
          : mobileServerConfigured
            ? "Mobile bridge ready for device pairing."
            : "Server-only mobile bridge secrets are incomplete.",
      },
    ];

    return noStoreJson({
      ok: true,
      ready: connectors.every((item) => item.configured),
      sendingEnabled: process.env.ENABLE_SEND_ACTIONS === "true",
      connectors,
      health: {
        runs,
        recentErrors,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
