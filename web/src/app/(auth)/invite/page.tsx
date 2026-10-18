"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput, passwordScore } from "@/components/auth/PasswordInput";
import { api, clearCache, type ApiError } from "@/lib/api";
import { normalisePhone } from "@/lib/format";

type InviteInfo = { email: string; role: string; role_name: string; business: string; invited_by: string | null };

/** Where a team member lands from their invite link and sets up their sign-in. */
export default function AcceptInvite() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState("");
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Read the token, then take it out of the address bar so it is not left in history or shared by accident.
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    window.history.replaceState(null, "", "/invite");
    setToken(t);
    if (!t) return setInvalid("This invite link is incomplete. Open it again from your email or message.");
    api<InviteInfo>("/app/auth/invite/describe", { body: { token: t } })
      .then(setInfo)
      .catch((e: ApiError) => setInvalid(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.firstName.trim() || !f.lastName.trim()) return setError("Enter your first and last name.");
    if (!normalisePhone(f.phone)) return setError("Enter a valid Safaricom number.");
    if (f.password.length < 10 || passwordScore(f.password) < 2) return setError("Use at least 10 characters, mixing letters with numbers or symbols.");
    setBusy(true);
    setError("");
    try {
      clearCache();
      await api("/app/auth/invite/accept", { body: { token, first_name: f.firstName.trim(), last_name: f.lastName.trim(), phone: normalisePhone(f.phone), password: f.password } });
      router.push("/dashboard");
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  if (invalid) {
    return (
      <AuthShell>
        <div className="auth-form">
          <div className="auth-head">
            <h1>This invite can&apos;t be used</h1>
            <p>{invalid}</p>
          </div>
          <Link href="/login" className="btn btn-line btn-block">Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <AuthShell>
        <div className="auth-form" style={{ justifyItems: "center" }}><span className="spinner" /></div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-head">
          <h1>Join {info.business}</h1>
          <p>
            {info.invited_by ? `${info.invited_by} invited you` : "You've been invited"} as <b>{info.role_name}</b>. Set up your sign-in for <b>{info.email}</b>.
          </p>
        </div>
        <div className="auth-row">
          <div className="field">
            <label className="label" htmlFor="fn">First name</label>
            <input id="fn" className="input" autoComplete="given-name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ln">Last name</label>
            <input id="ln" className="input" autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="ph">Phone number</label>
          <div className="input-group">
            <span className="prefix">+254</span>
            <input id="ph" className="input mono" type="tel" inputMode="tel" autoComplete="tel-national" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pw">Password</label>
          <PasswordInput id="pw" autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} meter />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-pine btn-lg btn-block" disabled={busy}>{busy ? <span className="spinner" /> : "Join the team"}</button>
      </form>
    </AuthShell>
  );
}
