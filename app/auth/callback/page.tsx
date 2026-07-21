"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../../../lib/supabase/browser";

type CallbackState = "working" | "success" | "error";

export default function MicrosoftCallbackPage() {
  const [state, setState] = useState<CallbackState>("working");
  const [detail, setDetail] = useState("Completing your Allied Fibreglass sign-in…");

  useEffect(() => {
    let active = true;

    async function completeConnection() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("Microsoft did not return a valid session.");

        const providerToken = data.session.provider_token;
        const providerRefreshToken = data.session.provider_refresh_token;
        if (!providerToken) {
          window.history.replaceState({}, document.title, "/auth/callback");
          window.location.replace("/reset-password");
          return;
        }

        const response = await fetch("/api/connectors/microsoft/session", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerToken,
            providerRefreshToken: providerRefreshToken || null,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "The Microsoft connection could not be stored securely.");
        }

        window.history.replaceState({}, document.title, "/auth/callback");
        if (!active) return;
        setState("success");
        setDetail("Microsoft 365 is connected. Returning to Allied Radar…");
        const nextPath = window.localStorage.getItem("allied-radar-auth-next") || "/";
        window.localStorage.removeItem("allied-radar-auth-next");
        window.setTimeout(() => window.location.replace(nextPath), 900);
      } catch (error) {
        if (!active) return;
        setState("error");
        setDetail(error instanceof Error ? error.message : "Microsoft connection failed.");
      }
    }

    void completeConnection();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="auth-shell">
      <section className="auth-card" data-state={state}>
        <span className="auth-mark" aria-hidden="true">AR</span>
        <p className="eyebrow">Allied Radar</p>
        <h1>{state === "error" ? "Connection needs attention" : "Connecting Microsoft 365"}</h1>
        <p>{detail}</p>
        {state === "error" && <Link href="/">Return to Allied Radar</Link>}
      </section>
    </main>
  );
}
