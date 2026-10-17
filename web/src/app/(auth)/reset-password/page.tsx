"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, NextSteps } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { api, clearCache, type ApiError } from "@/lib/api";

export default function ResetPassword() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  return (
    <AuthShell side={<NextSteps />}>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < 10) return setError("Use at least 10 characters.");
          setBusy(true);
          setError("");
          try {
            await api("/app/auth/reset", { body: { token, password } });
            clearCache();
            router.push("/dashboard");
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <div>
          <h1>Choose a new password</h1>
          <p className="sub">Other devices signed in to this account will be signed out.</p>
        </div>
        {!token ? (
          <div className="form-error">
            This link is incomplete. <Link className="link" href="/forgot-password">Ask for a new one</Link>.
          </div>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="password">New password</label>
              <PasswordInput id="password" autoComplete="new-password" value={password} onChange={setPassword} meter />
              <span className="hint">At least 10 characters.</span>
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-ink btn-lg btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : "Set password and sign in"}
            </button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
