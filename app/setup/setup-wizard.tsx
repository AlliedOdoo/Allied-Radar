"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getSupabaseBrowserClient,
  MICROSOFT_GRAPH_SCOPES,
} from "../../lib/supabase/browser";
import { humanSetupError } from "../../lib/setup/human-errors";

type ConnectorState = {
  id?: string;
  provider?: string;
  label: string;
  configured?: boolean;
  connected?: boolean;
  status?: string;
  detail?: string;
};

type HealthRun = {
  provider: string;
  status: string;
  started_at: string;
  fetched_count: number;
  stored_count: number;
  error_code?: string | null;
  error_message?: string | null;
};

type RecentError = {
  source: string;
  code?: string | null;
  message: string;
  created_at: string;
};

type StatusResponse = {
  ready?: boolean;
  sendingEnabled?: boolean;
  connectors?: ConnectorState[];
  services?: ConnectorState[];
  health?: {
    runs?: HealthRun[];
    recentErrors?: RecentError[];
  };
};

const setupSteps = [
  "Workspace",
  "Microsoft 365",
  "Odoo",
  "WhatsApp companion",
  "AI privacy",
  "Health",
];

function connectorKey(connector: ConnectorState) {
  return connector.id ?? connector.provider ?? connector.label.toLowerCase();
}

function stateLabel(connector?: ConnectorState) {
  if (!connector) return "Checking";
  if (connector.connected) return "Connected";
  if (connector.configured) return "Ready to connect";
  return "Admin setup needed";
}

export function SetupWizard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);

  const connectors = status?.connectors ?? status?.services ?? [];
  const byId = useMemo(
    () => new Map(connectors.map((connector) => [connectorKey(connector), connector])),
    [connectors],
  );
  const microsoft = byId.get("microsoft");
  const odoo = byId.get("odoo");
  const whatsapp = byId.get("whatsapp");
  const supabase = byId.get("supabase");
  const callbackUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/auth/callback`;

  async function sessionAuthorization() {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    setSignedIn(Boolean(data.session));
    return data.session ? `Bearer ${data.session.access_token}` : null;
  }

  async function loadStatus() {
    setLoading(true);
    setMessage(null);
    try {
      const authorization = await sessionAuthorization();
      if (!authorization) {
        setStatus(null);
        setMessage("Sign in with Microsoft 365 to view private setup status.");
        return;
      }

      const response = await fetch("/api/connectors/status", {
        cache: "no-store",
        headers: { Authorization: authorization },
      });
      const payload = (await response.json().catch(() => ({}))) as StatusResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Setup status is not available.");
      setStatus(payload);
    } catch (error) {
      setMessage(humanSetupError(error instanceof Error ? error.message : "Setup status failed."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function connectMicrosoft() {
    setMessage(null);
    const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: MICROSOFT_GRAPH_SCOPES,
      },
    });
    if (error) setMessage(humanSetupError(error.message));
  }

  async function syncConnector(connector: "microsoft" | "odoo") {
    setActionBusy(connector);
    setMessage(null);
    try {
      const authorization = await sessionAuthorization();
      if (!authorization) throw new Error("Sign in before syncing.");
      const response = await fetch(
        connector === "microsoft" ? "/api/connectors/microsoft/sync" : "/api/connectors/odoo/sync",
        {
          method: "POST",
          headers: { Authorization: authorization },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        stored?: number;
      };
      if (!response.ok) throw new Error(payload.error || payload.message || "Sync failed.");
      setMessage(`${connector === "microsoft" ? "Microsoft 365" : "Odoo"} synced. ${payload.stored ?? 0} message(s) stored.`);
      await loadStatus();
    } catch (error) {
      setMessage(humanSetupError(error instanceof Error ? error.message : "Sync failed."));
    } finally {
      setActionBusy(null);
    }
  }

  async function pairAndroid() {
    setActionBusy("pairing");
    setMessage(null);
    try {
      const authorization = await sessionAuthorization();
      if (!authorization) throw new Error("Sign in before pairing your phone.");
      const response = await fetch("/api/mobile/pairing/start", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: "Allied Radar Android", platform: "android" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !payload.code) throw new Error(payload.error || "Pairing code could not be created.");
      setPairingCode(payload.code);
      setPairingExpiresAt(payload.expiresAt ?? null);
    } catch (error) {
      setMessage(humanSetupError(error instanceof Error ? error.message : "Phone pairing failed."));
    } finally {
      setActionBusy(null);
    }
  }

  async function copyCallbackUrl() {
    await window.navigator.clipboard.writeText(callbackUrl);
    setMessage("Callback URL copied. Add it in Microsoft Entra only if admin setup asks for it.");
  }

  return (
    <main className="setup-shell">
      <section className="setup-hero">
        <div>
          <p className="eyebrow">Secure setup</p>
          <h1>Set up Allied Radar without exposing secrets.</h1>
          <span>
            Users connect their own accounts. Admin secrets stay server-side. AI remains off until a privacy-approved endpoint is configured.
          </span>
        </div>
        <div className="setup-hero-actions">
          <button className="secondary-action" type="button" onClick={() => window.location.assign("/")}>
            Open inbox
          </button>
          <button className="send-review-action" type="button" onClick={() => void loadStatus()}>
            {loading ? "Checking..." : "Refresh status"}
          </button>
        </div>
      </section>

      <nav className="setup-progress" aria-label="Setup steps">
        {setupSteps.map((step, index) => (
          <span key={step}>
            <small>{index + 1}</small>
            {step}
          </span>
        ))}
      </nav>

      {message && <p className="setup-message" role="status">{message}</p>}

      <section className="setup-grid">
        <article className="setup-card">
          <div className="setup-card-heading">
            <span>Workspace</span>
            <strong>{signedIn ? "Signed in" : "Sign in needed"}</strong>
          </div>
          <h2>Allied Fibreglass</h2>
          <p>
            One organization workspace. Each user gets isolated rows and encrypted account tokens; admins see setup health, not private inbox contents.
          </p>
          <dl>
            <div><dt>Database</dt><dd>{stateLabel(supabase)}</dd></div>
            <div><dt>RLS</dt><dd>Enabled and forced on current private tables</dd></div>
            <div><dt>Org foundation</dt><dd>Migration prepared; apply after MCP re-auth</dd></div>
          </dl>
        </article>

        <article className="setup-card">
          <div className="setup-card-heading">
            <span>Microsoft 365</span>
            <strong>{stateLabel(microsoft)}</strong>
          </div>
          <h2>Outlook and Teams</h2>
          <p>
            Users approve Microsoft access with OAuth. The app stores only encrypted delegated tokens for that signed-in user.
          </p>
          <div className="setup-actions">
            <button className="send-review-action" type="button" onClick={() => void connectMicrosoft()}>
              Connect Microsoft 365
            </button>
            <button className="secondary-action" disabled={actionBusy !== null} type="button" onClick={() => void syncConnector("microsoft")}>
              {actionBusy === "microsoft" ? "Syncing..." : "Sync Microsoft"}
            </button>
            <button className="secondary-action" type="button" onClick={() => void copyCallbackUrl()}>
              Copy callback URL
            </button>
          </div>
          <small>{microsoft?.detail || "No tenant secret is shown to users."}</small>
        </article>

        <article className="setup-card">
          <div className="setup-card-heading">
            <span>Odoo</span>
            <strong>{stateLabel(odoo)}</strong>
          </div>
          <h2>Odoo 18 Discuss</h2>
          <p>
            Odoo stays admin-configured for now. The user should never paste API keys into a normal inbox screen.
          </p>
          <div className="setup-actions">
            <button className="secondary-action" disabled={actionBusy !== null} type="button" onClick={() => void syncConnector("odoo")}>
              {actionBusy === "odoo" ? "Testing..." : "Test and sync Odoo"}
            </button>
          </div>
          <small>{odoo?.detail || "Admin setup stores Odoo credentials server-side only."}</small>
        </article>

        <article className="setup-card">
          <div className="setup-card-heading">
            <span>WhatsApp</span>
            <strong>{stateLabel(whatsapp)}</strong>
          </div>
          <h2>Android companion</h2>
          <p>
            WhatsApp is notification-and-handoff only. Radar can prepare messages; your phone still opens WhatsApp and you tap send.
          </p>
          <div className="setup-actions">
            <button className="secondary-action" disabled={actionBusy !== null} type="button" onClick={() => void pairAndroid()}>
              {actionBusy === "pairing" ? "Creating..." : "Pair Android phone"}
            </button>
          </div>
          {pairingCode && (
            <div className="pairing-code">
              <strong>{pairingCode}</strong>
              <span>{pairingExpiresAt ? `Expires ${new Date(pairingExpiresAt).toLocaleTimeString()}` : "Enter this in the companion app."}</span>
            </div>
          )}
          <small>{whatsapp?.detail || "No WhatsApp automation or scraping."}</small>
        </article>

        <article className="setup-card ai-privacy-card">
          <div className="setup-card-heading">
            <span>AI privacy</span>
            <strong>Off by default</strong>
          </div>
          <h2>AI cannot read inbox data until approved.</h2>
          <p>
            External AI is off by default. Radar can still do private local drafts, search help, and catch-up without sending inbox content to OpenRouter.
          </p>
          <dl>
            <div><dt>Current policy</dt><dd>Private local assistant enabled</dd></div>
            <div><dt>External AI</dt><dd>Disabled unless explicitly approved</dd></div>
          </dl>
        </article>

        <article className="setup-card health-card">
          <div className="setup-card-heading">
            <span>Health</span>
            <strong>{status?.ready ? "Core ready" : "Needs attention"}</strong>
          </div>
          <h2>Recent safe logs</h2>
          <p>No secret values or full message bodies are shown here.</p>
          <div className="setup-health-list">
            {status?.health?.runs?.slice(0, 5).map((run) => (
              <div key={`${run.provider}-${run.started_at}`}>
                <strong>{run.provider.replace("_", " ")}</strong>
                <span>{run.status} - {run.stored_count} stored / {run.fetched_count} fetched</span>
                {run.error_message && <small>{humanSetupError(run.error_message)}</small>}
              </div>
            ))}
            {status?.health?.recentErrors?.slice(0, 5).map((error) => (
              <div key={`${error.source}-${error.created_at}`}>
                <strong>{error.source}</strong>
                <span>{error.code || "error"}</span>
                <small>{humanSetupError(error.message)}</small>
              </div>
            ))}
            {!status?.health?.runs?.length && !status?.health?.recentErrors?.length && (
              <span className="setup-muted">No recent setup errors found.</span>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
