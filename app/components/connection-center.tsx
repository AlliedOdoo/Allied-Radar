"use client";

import { useEffect, useState } from "react";
import {
  getSupabaseBrowserClient,
  MICROSOFT_GRAPH_SCOPES,
} from "../../lib/supabase/browser";

type ConnectorState = {
  id?: string;
  provider?: string;
  label: string;
  configured?: boolean;
  connected?: boolean;
  status?: string;
  detail?: string;
};

type StatusResponse = {
  ready?: boolean;
  sendingEnabled?: boolean;
  connectors?: ConnectorState[];
  services?: ConnectorState[];
  health?: {
    runs?: Array<{
      provider: string;
      status: string;
      started_at: string;
      fetched_count: number;
      stored_count: number;
      error_code?: string | null;
      error_message?: string | null;
    }>;
    recentErrors?: Array<{
      source: string;
      code?: string | null;
      message: string;
      created_at: string;
    }>;
  };
};

const waitingConnectors: ConnectorState[] = [
  { id: "supabase", label: "Supabase", configured: false, detail: "Checking project connection…" },
  { id: "microsoft", label: "Microsoft 365", configured: false, detail: "Checking Allied Fibreglass sign-in…" },
  { id: "odoo", label: "Odoo 18", configured: false, detail: "Checking Odoo inbox notifications…" },
  { id: "whatsapp", label: "WhatsApp companion", configured: false, detail: "Android pairing is not complete." },
];

export function ConnectionCenter({ onClose }: { onClose: () => void }) {
  const [connectors, setConnectors] = useState(waitingConnectors);
  const [sendingEnabled, setSendingEnabled] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Checking configuration…");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState<"microsoft" | "odoo" | null>(null);
  const [health, setHealth] = useState<StatusResponse["health"] | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (active) {
            setConnectors((items) =>
              items.map((item) =>
                item.id === "supabase"
                  ? { ...item, configured: true, detail: "Project configured. Microsoft sign-in is next." }
                  : item,
              ),
            );
            setStatusMessage("Sign in with Microsoft 365 to load your private connector status.");
          }
          return;
        }

        const response = await fetch("/api/connectors/status", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const payload = (await response.json()) as StatusResponse;
        if (!response.ok) throw new Error("Status endpoint is not ready");
        if (!active) return;
        const reported = payload.connectors ?? payload.services;
        if (reported?.length) setConnectors(reported);
        setHealth(payload.health ?? null);
        setSendingEnabled(Boolean(payload.sendingEnabled));
        setStatusMessage(
          payload.ready
            ? "Core services are configured. Test each connector before enabling send."
            : "Setup is in progress. Sending remains safely paused.",
        );
      } catch {
        if (!active) return;
        setStatusMessage("The connection service is still being prepared. Sending remains safely paused.");
      }
    }
    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function connectMicrosoft() {
    setConnectError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: MICROSOFT_GRAPH_SCOPES,
        },
      });
      if (error) throw error;
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Microsoft sign-in could not start.");
    }
  }

  async function createPairingCode() {
    setConnectError(null);
    setPairingBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw new Error("Connect Microsoft 365 first so the phone can be paired to your account.");
      }
      const response = await fetch("/api/mobile/pairing/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: "Allied Radar Android", platform: "android" }),
      });
      const payload = (await response.json()) as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok || !payload.code) {
        throw new Error(payload.error || "A phone pairing code could not be created.");
      }
      setPairingCode(payload.code);
      setPairingExpiresAt(payload.expiresAt ?? null);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Phone pairing could not start.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function syncConnector(connector: "microsoft" | "odoo") {
    setConnectError(null);
    setSyncBusy(connector);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Connect Microsoft 365 before syncing inboxes.");

      const label = connector === "microsoft" ? "Microsoft 365" : "Odoo";
      const endpoint = connector === "microsoft" ? "/api/connectors/microsoft/sync" : "/api/connectors/odoo/sync";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        stored?: number;
      };
      if (!response.ok) {
        throw new Error(`${label}: ${payload.error || payload.message || response.statusText || "sync failed"}`);
      }

      const stored = typeof payload.stored === "number" ? payload.stored : 0;
      setStatusMessage(`${label} synced. ${stored} message${stored === 1 ? "" : "s"} stored.`);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Inbox sync failed.");
    } finally {
      setSyncBusy(null);
    }
  }

  return (
    <div className="connection-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="connection-center-title" aria-modal="true" className="connection-center" role="dialog">
        <header className="connection-heading">
          <div>
            <p className="eyebrow">Private setup</p>
            <h2 id="connection-center-title">Connections</h2>
          </div>
          <button aria-label="Close connections" className="dialog-close" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="master-send-state" data-enabled={sendingEnabled}>
          <span className="connector-dot" />
          <div>
            <strong>{sendingEnabled ? "Sending enabled" : "Sending safely paused"}</strong>
            <small>{statusMessage}</small>
          </div>
        </div>

        <div className="connection-list">
          {connectors.map((connector) => {
            const ready = connector.connected === true;
            const connectorId = connector.id ?? connector.provider ?? connector.label;
            return (
              <article className="connection-item" data-ready={ready} key={connectorId}>
                <span className="connection-status" aria-hidden="true">{ready ? "✓" : "·"}</span>
                <div>
                  <strong>{connector.label}</strong>
                  <p>{connector.detail || connector.status || "Not connected"}</p>
                </div>
                <span>{ready ? "Ready" : "Setup"}</span>
              </article>
            );
          })}
        </div>

        <div className="connection-actions">
          <button className="send-review-action" onClick={connectMicrosoft} type="button">
            Connect Microsoft 365
          </button>
          <small>Uses delegated access for the signed-in Allied Fibreglass user.</small>

          <button
            className="secondary-action"
            disabled={syncBusy !== null}
            onClick={() => syncConnector("microsoft")}
            type="button"
          >
            {syncBusy === "microsoft" ? "Syncing Microsoft 365…" : "Sync Microsoft 365"}
          </button>

          <button
            className="secondary-action"
            disabled={syncBusy !== null}
            onClick={() => syncConnector("odoo")}
            type="button"
          >
            {syncBusy === "odoo" ? "Syncing Odoo…" : "Sync Odoo inbox"}
          </button>

          <button className="secondary-action" disabled={pairingBusy} onClick={createPairingCode} type="button">
            {pairingBusy ? "Creating code…" : "Pair Android companion"}
          </button>

          {pairingCode && (
            <div className="pairing-code" role="status">
              <strong>{pairingCode}</strong>
              <span>
                Enter this once in the Android companion
                {pairingExpiresAt ? ` before ${new Date(pairingExpiresAt).toLocaleTimeString()}.` : "."}
              </span>
            </div>
          )}
        </div>

        {connectError && <p className="send-feedback error" role="status">{connectError}</p>}

        {(health?.runs?.length || health?.recentErrors?.length) && (
          <div className="connection-health">
            <div className="section-heading">
              <span>Health and logs</span>
              <small>Latest connector truth</small>
            </div>
            {health.runs?.slice(0, 4).map((run) => (
              <article className="health-row" key={`${run.provider}-${run.started_at}`}>
                <strong>{run.provider.replace("_", " ")}</strong>
                <span>{run.status}</span>
                <small>
                  {run.stored_count} stored / {run.fetched_count} fetched
                  {run.error_message ? ` · ${run.error_message}` : ""}
                </small>
              </article>
            ))}
            {health.recentErrors?.slice(0, 3).map((error) => (
              <article className="health-row error" key={`${error.source}-${error.created_at}`}>
                <strong>{error.source}</strong>
                <span>{error.code || "error"}</span>
                <small>{error.message}</small>
              </article>
            ))}
          </div>
        )}

        <div className="connection-note">
          <strong>No secret values are displayed here.</strong>
          <span>Credentials stay in local or Cloudflare server-only secrets.</span>
        </div>
      </section>
    </div>
  );
}
