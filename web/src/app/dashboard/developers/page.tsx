"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { Empty, PageHeader, useToast } from "@/components/dash/ui";
import { dateTime, timeAgo } from "@/lib/format";
import { SITE } from "@/lib/site";
import { revokeKey, rollKey, useStore } from "@/lib/store";

const mask = (k: string) => k.slice(0, 8) + "•".repeat(16) + k.slice(-4);

export default function ApiKeys() {
  const s = useStore();
  const toast = useToast();
  const { open } = useActions();
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
          <button className="btn btn-pine" onClick={() => open("key")} disabled={liveLocked}>
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

    </>
  );
}
