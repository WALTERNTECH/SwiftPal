"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Icon } from "@/components/Icon";
import { api, clearCache, type ApiError } from "@/lib/api";

export default function ResetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  if (done) {
    return (
      <AuthShell>
        <div className="auth-form">
          <div className="auth-done">
            <span className="ring">
              <Icon name="check" size={22} strokeWidth={2.4} />
            </span>
            <div className="auth-head">
              <h1>Password updated</h1>
              <p>Sign in with your new password.</p>
            </div>
          </div>
          <Link href="/login" className="btn btn-pine btn-lg btn-block">
            Sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
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
            setDone(true);
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <div className="auth-head">
          <h1>Choose a new password</h1>
        </div>
        {token === "" ? (
          <div className="form-error">
            This link is incomplete. <Link className="link" href="/forgot-password">Ask for a new one</Link>.
          </div>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="password">New password</label>
              <PasswordInput id="password" autoComplete="new-password" value={password} onChange={setPassword} meter />
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-pine btn-lg btn-block" disabled={busy || token === null}>
              {busy ? <span className="spinner" /> : "Update password"}
            </button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
