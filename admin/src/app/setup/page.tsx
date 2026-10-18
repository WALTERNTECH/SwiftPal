"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { api, useWaking, type ApiError } from "@/lib/api";

/** Creates the owner account. Needs the server's setup key, and closes once an owner exists. */
export default function Setup() {
  const router = useRouter();
  const waking = useWaking();
  const [f, setF] = useState({ key: "", name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ needs_setup: boolean }>("/auth/state")
      .then((s) => !s.needs_setup && router.replace("/login"))
      .catch(() => {});
  }, [router]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <AuthCard>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!f.key.trim()) return setError("Enter the setup key.");
          if (f.name.trim().length < 2 || !f.email.includes("@")) return setError("Enter your name and email.");
          if (f.password.length < 12) return setError("Use a password of at least 12 characters.");
          if (f.password !== f.confirm) return setError("The passwords don't match.");
          setBusy(true);
          setError("");
          try {
            await api("/auth/setup", { body: { setup_key: f.key.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password } });
            router.push("/two-step");
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <div className="auth-head">
          <h1>Create the owner account</h1>
        </div>
        <div className="field">
          <label className="label" htmlFor="key">Setup key</label>
          <input id="key" className="input mono" type="password" autoComplete="off" value={f.key} onChange={set("key")} />
        </div>
        <div className="field">
          <label className="label" htmlFor="name">Full name</label>
          <input id="name" className="input" autoComplete="name" value={f.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={f.email} onChange={set("email")} />
        </div>
        <div className="auth-row">
          <div className="field">
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pw2">Confirm</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set("confirm")} />
          </div>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Create owner account"}
        </button>
        {busy && waking && <p className="hint" style={{ textAlign: "center" }}>Starting up. This can take up to a minute.</p>}
      </form>
    </AuthCard>
  );
}
