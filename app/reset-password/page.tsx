"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/browser";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (password.length < 8) throw new Error("Use at least 8 characters.");
      if (password !== confirmPassword) throw new Error("Passwords do not match.");
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setMessage("Password updated. You can sign in now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="auth-mark" aria-hidden="true">AR</span>
        <p className="eyebrow">Choose password</p>
        <h1>Create a new password.</h1>
        <p>This page works after opening the secure reset link from your email.</p>

        {!done && (
          <form className="auth-form" onSubmit={(event) => void updatePassword(event)}>
            <label>
              <span>New password</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <label>
              <span>Confirm password</span>
              <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <button className="send-review-action" type="submit" disabled={busy}>
              {busy ? "Saving..." : "Update password"}
            </button>
          </form>
        )}

        {message && <p className="auth-message" role="status">{message}</p>}

        <nav className="auth-links">
          <Link href="/signin">Back to sign in</Link>
          <Link href="/setup">Setup</Link>
        </nav>
      </section>
    </main>
  );
}
