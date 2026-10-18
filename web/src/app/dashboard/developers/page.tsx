"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { Integrate } from "@/components/dash/Integrate";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, useApi, useMode, type ApiError, type ApiKey } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { SITE } from "@/lib/site";

export default function ApiKeys() {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const { open } = useActions();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  // Rolling a live key issues a new secret, so it takes the authenticator code when two-step is on.
  const [rolling, setRolling] = useState<ApiKey | null>(null);
  const [rollCode, setRollCode] = useState("");
  const { data: all, loading } = useApi<ApiKey[]>("/app/keys");
  const keys = (all ?? []).filter((k) => k.mode === mode);
  const liveLocked = mode === "live" && !me.merchant.live_enabled;

  async function roll(k: ApiKey, code?: string) {
    if (k.mode === "live" && me.user.two_factor && !code) {
      setRollCode("");
      setRolling(k);
      return;
    }
    if (!code && !confirm(`Roll "${k.name}"? A new secret is issued and the old one stops working immediately.`)) return;
    try {
      const r = await api<{ id: string; secret: string }>(`/app/keys/${k.id}/roll`, { body: { code } });
      invalidate("/app/keys");
      setRolling(null);
      setFresh({ name: k.name, secret: r.secret });
      toast("Key rolled. Copy the new secret now.");
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
  }

  async function revoke(k: ApiKey) {
    if (!confirm(`Revoke "${k.name}"? Requests using it will fail immediately with 401.`)) return;
    try {
      await api(`/app/keys/${k.id}`, { method: "DELETE" });
      invalidate("/app/keys");
      toast("Key revoked");
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
  }

  return (
    <>
      <PageHeader
        title="API keys"
        sub={
          <>
            Send as <code className="inline-code">Authorization: Bearer &lt;key&gt;</code> to <span className="mono">{SITE.apiBase}</span>
          </>
        }
        actions={
          <button className="btn btn-pine" onClick={() => open("key")} disabled={liveLocked}>
            <Icon name="plus" size={15} /> Create API key
          </button>
        }
      />

      {liveLocked && (
        <div className="callout warn">
          <Icon name="lock" size={16} />
          <span className="grow">{me.merchant.verification_status === "submitted" ? "API keys open once your verification is approved." : "Verify your account to create API keys."}</span>
          {me.merchant.verification_status !== "submitted" && <Link href="/dashboard/verification" className="btn btn-pine btn-sm">Verify</Link>}
        </div>
      )}

      {fresh && (
        <div className="keybox rise">
          <div className="keybox-head">
            <span className={`badge ${mode === "live" ? "ok" : "warn"}`}>{mode === "live" ? "Live" : "Test"}</span>
            <span className="muted grow" style={{ fontSize: 13 }}>New secret for {fresh.name}{mode === "live" ? ". It's shown once." : ""}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setFresh(null)} aria-label="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="keybox-row">
            <code className="secret" style={{ wordBreak: "break-all" }}>{fresh.secret}</code>
            <span className="keybox-copy"><CopyButton text={fresh.secret} /></span>
          </div>
        </div>
      )}

      <section className="panel rise">
        {keys.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Secret key</th><th>Scopes</th><th>Last used</th><th>Created</th><th /></tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td><b style={{ fontWeight: 500 }}>{k.name}</b></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="secret">{k.secret && shown[k.id] ? k.secret : k.masked}</span>
                        {k.secret ? (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShown({ ...shown, [k.id]: !shown[k.id] })} aria-label={shown[k.id] ? "Hide key" : "Reveal key"}>
                              <Icon name={shown[k.id] ? "eyeOff" : "eye"} size={14} />
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(k.secret!); toast("Key copied"); }} aria-label="Copy key">
                              <Icon name="copy" size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="dim" style={{ fontSize: 12 }} title="Live secrets are shown once. Roll the key to get a new one.">
                            <Icon name="lock" size={13} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td><div className="scope-list">{k.scopes.map((sc) => <span key={sc} className="tag">{sc}</span>)}</div></td>
                    <td className="muted">{k.last_used_at ? timeAgo(k.last_used_at) : "Never"}</td>
                    <td className="muted">{dateTime(k.created_at)}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => roll(k)}>
                          <Icon name="refresh" size={14} /> Roll
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} onClick={() => revoke(k)}>
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="key" title="No API keys yet" body={liveLocked ? "Available once your account is verified." : "Create a key and add it to your server as SWIFTPAL_SECRET_KEY."} />
        )}
      </section>

      <Integrate />

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel panel-body">
          <b>Keep keys on your server</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            Secret keys can move money. Never ship them in a mobile app, a browser bundle or a public repo. If one leaks, roll it here.
          </p>
        </div>
        <div className="panel panel-body">
          <b>Live secrets are shown once</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            We store a hash of each live key, so it can&apos;t be shown again. Lost one? Roll it and update your server with the new secret.
          </p>
        </div>
      </div>
      <Modal
        open={!!rolling}
        onClose={() => setRolling(null)}
        title={`Roll "${rolling?.name ?? ""}"`}
        footer={
          <>
            <button className="btn btn-line" onClick={() => setRolling(null)}>Cancel</button>
            <button className="btn btn-pine" disabled={rollCode.length !== 6} onClick={() => rolling && roll(rolling, rollCode)}>Roll key</button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 13.5 }}>A new secret is issued and the old one stops working immediately. Enter the code from your authenticator app.</p>
        <input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Code" value={rollCode} onChange={(e) => setRollCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
      </Modal>
    </>
  );
}
