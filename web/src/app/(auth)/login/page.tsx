"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { CodeBlock } from "@/components/CodeBlock";
import { getState, signIn } from "@/lib/store";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) || !password) {
      setError("Enter the email and password you signed up with.");
      return;
    }
    setBusy(true);
    signIn(email.trim().toLowerCase());
    const s = getState();
    setTimeout(() => {
      if (!s.account?.emailVerified) router.push("/verify-email");
      else if (!s.onboardingDone) router.push("/onboarding");
      else router.push("/dashboard");
    }, 350);
  }

  return (
    <AuthShell
      topRight={
        <span className="muted" style={{ fontSize: 14 }}>
          New to SwiftPal? <Link className="link" href="/signup">Create an account</Link>
        </span>
      }
      side={
        <>
          <div>
            <div className="eyebrow" style={{ color: "#6fbf9b" }}>Status</div>
            <h2 style={{ marginTop: 12 }}>Your integration, at a glance.</h2>
            <p className="muted" style={{ marginTop: 10 }}>
              Balances, success rate and the last webhook delivery are on the first screen after you sign in.
            </p>
          </div>
          <CodeBlock
            tabs={[
              {
                label: "GET /v1/balance",
                lang: "json",
                code: `{
  "fee_credit":   { "available": 1847.5, "held": 12.5 },
  "payout_float": { "available": 84200,  "held": 3500 },
  "currency": "KES"
}`,
              },
            ]}
          />
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div>
          <h1>Sign in</h1>
          <p className="sub">Welcome back.</p>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
        </div>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="password">Password</label>
            <Link href="/forgot-password" className="link" style={{ fontSize: 13 }}>Forgot password?</Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(v) => { setPassword(v); setError(""); }} />
        </div>
        <button className="btn btn-ink btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Sign in"}
        </button>
        <p className="hint" style={{ textAlign: "center" }}>
          Preview build: any email and password signs you into a demo account.
        </p>
      </form>
    </AuthShell>
  );
}
