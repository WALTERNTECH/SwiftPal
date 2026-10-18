"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { VerifyCode } from "@/components/auth/VerifyCode";
import { api, clearCache, nextStep, type ApiError, type Me, useWaking } from "@/lib/api";
import { phoneHint } from "@/lib/format";

type LoginResult = { otp_required: true; phone_hint: string; error?: string } | { otp_required: false };

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const waking = useWaking();
  const [otp, setOtp] = useState<{ hint: string; error?: string } | null>(null);

  async function finish() {
    const me = await api<Me>("/app/me");
    // Back to where sign-in was asked for (e.g. approving an assistant), same-site paths only.
    const next = new URLSearchParams(window.location.search).get("next");
    const step = nextStep(me);
    router.push(next && next.startsWith("/") && !next.startsWith("//") && step === "/dashboard" ? next : step);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError("");
    try {
      clearCache();
      const r = await api<LoginResult>("/app/auth/login", { body: { email: email.trim().toLowerCase(), password } });
      if (r.otp_required) {
        setOtp({ hint: r.phone_hint, error: r.error });
        setBusy(false);
      } else await finish();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  if (otp) {
    return (
      <AuthShell>
        <VerifyCode
          title="Enter your sign-in code"
          sentTo={<b className="mono">{phoneHint(otp.hint)}</b>}
          initialError={otp.error}
          onVerify={async (code) => {
            await api("/app/auth/login/verify", { body: { code } });
            await finish();
          }}
          onResend={() => api("/app/auth/login/resend", { method: "POST" })}
          aside={
            <button type="button" className="text-btn quiet" onClick={() => { setOtp(null); setPassword(""); }}>
              Use another account
            </button>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      alt={
        <>
          New to SwiftPal? <Link className="link" href="/signup">Create an account</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-head">
          <h1>Sign in</h1>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Business email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
        </div>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="password">Password</label>
            <Link href="/forgot-password" className="link" style={{ fontSize: 13 }}>Forgot password?</Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(v) => { setPassword(v); setError(""); }} />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Continue"}
        </button>
        {busy && waking && <p className="hint" style={{ textAlign: "center" }}>Starting up. This can take up to a minute.</p>}
      </form>
    </AuthShell>
  );
}
