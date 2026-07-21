"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/browser";

export default function SignUpPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.includes("@")) throw new Error("Use your Microsoft 365 work email address.");
      const { error } = await getSupabaseBrowserClient().auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/signin?created=1`,
          data: {
            display_name: displayName.trim(),
            work_email: normalizedEmail,
          },
        },
      });
      if (error) throw error;
      setMessage("Account created. Check your email if confirmation is required, then sign in.");
      setDisplayName("");
      setEmail("");
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="auth-mark" aria-hidden="true">AR</span>
        <p className="eyebrow">Create account</p>
        <h1>Create your Allied Radar account.</h1>
        <p>Use your Microsoft 365 work email. Each user connects their own mailbox and gets isolated private data.</p>

        <form className="auth-form" onSubmit={(event) => void createAccount(event)}>
          <label>
            <span>Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="Ferdi" required />
          </label>
          <label>
            <span>365 email address</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@alliedfibreglass.co.za" required />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <button className="send-review-action" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>

        {message && <p className="auth-message" role="status">{message}</p>}

        <nav className="auth-links">
          <Link href="/signin">Already have an account?</Link>
          <Link href="/setup">Setup</Link>
        </nav>
      </section>
    </main>
  );
}
