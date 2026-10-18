"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { api, type ApiError } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AuthShell
      alt={
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      }
    >
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.includes("@")) return setError("Enter the email you signed up with.");
          setBusy(true);
          setError("");
          try {
            await api("/app/auth/forgot", { body: { email: email.trim() } });
            setSent(true);
          } catch (err) {
            setError((err as ApiError).message);
          }
          setBusy(false);
        }}
      >
        <div className="auth-head">
          <h1>Reset your password</h1>
          <p>{sent ? <>If <b>{email}</b> has an account, a reset link is on its way.</> : "We'll email you a reset link."}</p>
        </div>
        {!sent && (
          <>
            <div className="field">
              <label className="label" htmlFor="email">Business email</label>
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : "Send reset link"}
            </button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
