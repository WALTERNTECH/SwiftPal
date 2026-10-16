"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { dateTime, timeAgo } from "@/lib/format";
import { SITE } from "@/lib/site";
import { createKey, revokeKey, rollKey, useStore, type ApiKey, type Mode } from "@/lib/store";

const SCOPES = [
  { v: "payments:write", d: "Create STK Push requests" },
  { v: "payouts:write", d: "Create single and bulk payouts" },
  { v: "read", d: "Read payments, payouts, balances and events" },
];

const mask = (k: string) => k.slice(0, 8) + "•".repeat(16) + k.slice(-4);

export default function ApiKeys() {
  const s = useStore();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<ApiKey | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const keys = s.keys.filter((k) => k.mode === s.mode);
  const liveLocked = s.mode === "live" && !s.channels.some((c) => c.status === "verified");

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
          <button className="btn btn-ink" onClick={() => setCreating(true)} disabled={liveLocked}>
            <Icon name="plus" size={15} /> Create {s.mode} key
          </button>
        }
      />

      {liveLocked && (
        <div className="callout warn">
          <Icon name="lock" size={16} />
          <span className="grow">Live keys are issued once a Till or Paybill is verified.</span>
          <Link href="/dashboard/channels" className="btn btn-line btn-sm">Verify a channel</Link>
        </div>
      )}

      <section className="panel">
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
                        <span className="secret">{shown[k.id] ? k.secret : mask(k.secret)}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShown({ ...shown, [k.id]: !shown[k.id] })} aria-label={shown[k.id] ? "Hide key" : "Reveal key"}>
                          <Icon name={shown[k.id] ? "eyeOff" : "eye"} size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(k.secret); toast("Key copied"); }} aria-label="Copy key">
                          <Icon name="copy" size={14} />
                        </button>
                      </div>
                    </td>
                    <td><div className="scope-list">{k.scopes.map((sc) => <span key={sc} className="tag">{sc}</span>)}</div></td>
                    <td className="muted">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}</td>
                    <td className="muted">{dateTime(k.createdAt)}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            if (confirm(`Roll "${k.name}"? A new secret is issued. In production the old one keeps working for the grace period you pick.`)) {
                              rollKey(k.id);
                              setShown({ ...shown, [k.id]: true });
                              toast("Key rolled. Copy the new secret now.");
                            }
                          }}
                        >
                          <Icon name="refresh" size={14} /> Roll
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--bad)" }}
                          onClick={() => {
                            if (confirm(`Revoke "${k.name}"? Requests using it will fail immediately with 401.`)) {
                              revokeKey(k.id);
                              toast("Key revoked");
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="key" title={`No ${s.mode} keys`} body={s.mode === "live" ? "Create a live key once your channel is verified." : "Create a test key to start calling the API."} />
        )}
      </section>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel panel-body">
          <b>Keep keys on your server</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            Secret keys can move money. Never ship them in a mobile app, a browser bundle or a public repo. If one leaks, roll it here.
          </p>
        </div>
        <div className="panel panel-body">
          <b>Restrict by IP</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            Live keys can be limited to your server&apos;s addresses. Requests from anywhere else get <code className="inline-code">403 ip_not_allowed</code>.
          </p>
        </div>
      </div>

      <CreateKey open={creating} mode={s.mode} onClose={() => setCreating(false)} onCreated={(k) => { setCreating(false); setFresh(k); }} />

      <Modal open={!!fresh} onClose={() => setFresh(null)} title="Copy your new key" footer={<button className="btn btn-ink" onClick={() => setFresh(null)}>I&apos;ve stored it</button>}>
        <div className="callout warn">
          <Icon name="alert" size={16} />
          <span>This is the only time the full key is shown in production. Store it in your secrets manager now.</span>
        </div>
        <div className="keybox-row panel" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12 }}>
          <code className="secret" style={{ wordBreak: "break-all" }}>{fresh?.secret}</code>
          <span className="keybox-copy"><CopyButton text={fresh?.secret ?? ""} /></span>
        </div>
      </Modal>
    </>
  );
}

function CreateKey({ open, mode, onClose, onCreated }: { open: boolean; mode: Mode; onClose: () => void; onCreated: (k: ApiKey) => void }) {
  const s = useStore();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["payments:write", "read"]);
  const payoutsLocked = mode === "live" && s.verification !== "approved";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create ${mode} key`}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" disabled={!name.trim() || !scopes.length} onClick={() => { onCreated(createKey(name.trim(), mode, scopes)); setName(""); }}>
            Create key
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="kn">Name</label>
        <input id="kn" className="input" placeholder="checkout-service" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="hint">Name it after the service that uses it, so you know what breaks if you revoke it.</span>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Scopes</legend>
        {SCOPES.map((sc) => {
          const disabled = sc.v === "payouts:write" && payoutsLocked;
          return (
            <label key={sc.v} className="check" style={{ opacity: disabled ? 0.5 : 1, marginBottom: 8 }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={scopes.includes(sc.v)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, sc.v] : scopes.filter((x) => x !== sc.v))}
              />
              <span>
                <code className="inline-code">{sc.v}</code> {sc.d}
                {disabled && <span className="dim"> · needs approved business details</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
    </Modal>
  );
}
