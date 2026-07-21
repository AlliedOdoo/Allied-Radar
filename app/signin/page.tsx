"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient, MICROSOFT_GRAPH_SCOPES } from "../../lib/supabase/browser";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nextPath, setNextPath] = useState("/");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(safeNext(params.get("next")));
    if (params.get("created") === "1") {
      setMessage("Account created. Check your email if confirmation is required, then sign in.");
    }
  }, []);

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      window.location.replace(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithMicrosoft() {
    setBusy(true);
    setMessage(null);
    try {
      window.localStorage.setItem("allied-radar-auth-next", nextPath);
      const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: MICROSOFT_GRAPH_SCOPES,
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Microsoft sign-in could not start.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="auth-mark" aria-hidden="true">AR</span>
        <p className="eyebrow">Secure sign in</p>
        <h1>Welcome back to Allied Radar.</h1>
        <p>Your inbox stays private. Tokens are encrypted server-side and secrets are never shown in the browser.</p>

        <button className="auth-oauth-button" type="button" disabled={busy} onClick={() => void signInWithMicrosoft()}>
          Sign in with Microsoft 365
        </button>

        <div className="auth-divider"><span>or use your work email</span></div>

        <form className="auth-form" onSubmit={(event) => void signInWithPassword(event)}>
          <label>
            <span>365 email address</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@alliedfibreglass.co.za" required />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          <button className="send-review-action" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {message && <p className="auth-message" role="status">{message}</p>}

        <nav className="auth-links">
          <Link href="/signup">Create account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href="/setup">Setup</Link>
        </nav>
      </section>
    </main>
  );
}
