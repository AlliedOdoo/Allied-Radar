"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (error) throw error;
      setMessage("Password reset email sent. Open the link from your email to choose a new password.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password reset email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="auth-mark" aria-hidden="true">AR</span>
        <p className="eyebrow">Password reset</p>
        <h1>Reset your password.</h1>
        <p>Enter your Microsoft 365 work email and we’ll send a secure reset link.</p>

        <form className="auth-form" onSubmit={(event) => void sendReset(event)}>
          <label>
            <span>365 email address</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@alliedfibreglass.co.za" required />
          </label>
          <button className="send-review-action" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send reset email"}
          </button>
        </form>

        {message && <p className="auth-message" role="status">{message}</p>}

        <nav className="auth-links">
          <Link href="/signin">Back to sign in</Link>
        </nav>
      </section>
    </main>
  );
}
