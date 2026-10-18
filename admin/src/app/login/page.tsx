"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { api, clearCache, useWaking, type ApiError, type Stage } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const waking = useWaking();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ needs_setup: boolean }>("/auth/state")
      .then((s) => s.needs_setup && router.replace("/setup"))
      .catch(() => {});
  }, [router]);

  return (
    <AuthCard>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.includes("@") || !password) return setError("Enter your email and password.");
          setBusy(true);
          setError("");
          try {
            clearCache();
            await api<{ stage: Stage }>("/auth/login", { body: { email: email.trim(), password } });
            router.push("/two-step");
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <div className="auth-head">
          <h1>Sign in to the console</h1>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Continue"}
        </button>
        {busy && waking && <p className="hint" style={{ textAlign: "center" }}>Starting up. This can take up to a minute.</p>}
      </form>
    </AuthCard>
  );
}
