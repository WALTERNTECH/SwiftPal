"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Icon } from "@/components/Icon";
import { api, invalidate, useApi, useMe, type ApiError } from "@/lib/api";

type Req = { user_code: string; client_name: string; status: "pending" | "approved" | "denied" | "claimed" | "expired"; created_at: string };

const SCOPES = [
  { v: "payments:write", t: "Request payments" },
  { v: "payouts:write", t: "Send payouts" },
  { v: "read", t: "Read payments and balances" },
];

/** Where the merchant approves an assistant or CLI that asked for an API key. */
export default function Connect() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const { data: me, error: meError } = useMe();
  const { data: req, error } = useApi<Req>(code && me ? `/app/connect/${encodeURIComponent(code)}` : null);
  const [scopes, setScopes] = useState(SCOPES.map((s) => s.v));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    setCode(new URLSearchParams(window.location.search).get("code") ?? "");
  }, []);

  useEffect(() => {
    if (meError?.status === 401 && code) router.replace(`/login?next=${encodeURIComponent(`/connect?code=${code}`)}`);
  }, [meError, code, router]);

  async function answer(kind: "approve" | "deny") {
    setBusy(true);
    setFailure("");
    try {
      await api(`/app/connect/${encodeURIComponent(code!)}/${kind}`, { body: kind === "approve" ? { scopes } : {} });
      if (kind === "approve") await invalidate("/app/keys");
      setResult(kind === "approve" ? "approved" : "denied");
    } catch (err) {
      setFailure((err as ApiError).message);
    }
    setBusy(false);
  }

  const waiting = code === null || !me || (!req && !error);
  const approved = me?.merchant.verification_status === "approved";

  return (
    <AuthShell>
      {code === "" ? (
        <Notice icon="alert" title="No connection code" body="Open the link your assistant gave you." />
      ) : waiting ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 160 }}>
          <span className="spinner" />
        </div>
      ) : error ? (
        <Notice icon="alert" title="Connection not found" body={error.message} />
      ) : result === "approved" ? (
        <Notice icon="check" ok title={`${req!.client_name} is connected`} body="Return to it. It has the API key it needs, and you'll find the key under API keys." action={<Link href="/dashboard/developers" className="btn btn-line btn-block">View API keys</Link>} />
      ) : result === "denied" ? (
        <Notice icon="x" title="Connection declined" body="No key was created." />
      ) : req!.status !== "pending" ? (
        <Notice icon="clock" title={req!.status === "expired" ? "This request expired" : "Already answered"} body="Ask your assistant to start a new connection." />
      ) : (
        <div className="auth-form">
          <div className="auth-head">
            <h1>Connect {req!.client_name}</h1>
            <p>
              It's asking for an API key for <b>{me!.merchant.name}</b>.
            </p>
          </div>
          <div className="connect-code">
            <span>Code</span>
            <b className="mono">{req!.user_code}</b>
            <em>Check it matches the code your assistant shows.</em>
          </div>
          {approved ? (
            <>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="label" style={{ marginBottom: 8 }}>Allow it to</legend>
                <div className="stack" style={{ gap: 8 }}>
                  {SCOPES.map((s) => (
                    <label key={s.v} className="check">
                      <input type="checkbox" checked={scopes.includes(s.v)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.v] : scopes.filter((x) => x !== s.v))} />
                      <span>{s.t}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {failure && <div className="form-error">{failure}</div>}
              <div className="stack" style={{ gap: 10 }}>
                <button className="btn btn-pine btn-lg btn-block" disabled={busy || !scopes.length} onClick={() => answer("approve")}>
                  {busy ? <span className="spinner" /> : "Approve"}
                </button>
                <button className="btn btn-line btn-lg btn-block" disabled={busy} onClick={() => answer("deny")}>
                  Decline
                </button>
              </div>
            </>
          ) : (
            <div className="callout">
              <Icon name="idcard" size={16} />
              <span className="grow">API keys open once your account is verified.</span>
              <Link href="/dashboard/verification" className="btn btn-pine btn-sm">Verify</Link>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}

function Notice({ icon, title, body, ok, action }: { icon: "check" | "x" | "alert" | "clock"; title: string; body: string; ok?: boolean; action?: React.ReactNode }) {
  return (
    <div className="auth-form">
      <div className="auth-done">
        <span className={`ring ${ok ? "" : "neutral"}`}>
          <Icon name={icon} size={22} strokeWidth={2.2} />
        </span>
        <div className="auth-head">
          <h1>{title}</h1>
          <p>{body}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
