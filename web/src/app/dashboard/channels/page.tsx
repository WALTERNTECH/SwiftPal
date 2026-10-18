"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { Empty, PageHeader, useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, type ApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";

export default function Channels() {
  const me = useAccount();
  const toast = useToast();
  const { open } = useActions();
  const vs = me.merchant.verification_status;
  const approved = vs === "approved";

  async function act(path: string, method: string, done: string) {
    try {
      await api(path, { method });
      invalidate("/app/me", "/app/channels");
      toast(done);
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
  }

  return (
    <>
      <PageHeader
        title="Channels"
        sub="Tills and Paybills your STK Push requests route to"
        actions={
          <button className="btn btn-pine" onClick={() => open("channel")} disabled={!approved}>
            <Icon name="plus" size={15} /> Add Till or Paybill
          </button>
        }
      />

      {!approved && (
        <div className="callout rise">
          <Icon name="idcard" size={16} />
          <span className="grow">{vs === "submitted" ? "Available once your verification is approved." : "Verify your account to add a Till or Paybill."}</span>
          {vs !== "submitted" && (
            <Link href="/dashboard/verification" className="btn btn-pine btn-sm">
              Verify
            </Link>
          )}
        </div>
      )}

      {me.channels.length ? (
        <div className="tile-grid">
          {me.channels.map((c, i) => (
            <div key={c.id} className="panel channel-card rise" style={{ ["--d" as string]: `${i * 60}ms` }}>
              <div className="spread">
                <span className={`tag ${c.kind === "till" ? "post" : "get"}`}>{c.kind === "till" ? "TILL · BUY GOODS" : "PAYBILL"}</span>
                <span className="badge ok">Active</span>
              </div>
              <div>
                <div className="channel-code">{c.shortcode}</div>
                <div className="muted" style={{ fontSize: 13 }}>{c.display_name}</div>
              </div>
              <dl className="kv" style={{ fontSize: 13 }}>
                {c.kind === "paybill" && (
                  <div><dt>Account number</dt><dd className="mono">{c.account_number ?? "—"}</dd></div>
                )}
                <div><dt>Channel ID</dt><dd className="mono">{c.id}</dd></div>
                <div><dt>Default</dt><dd>{c.is_default ? "Yes" : "No"}</dd></div>
                <div><dt>Added</dt><dd>{dateTime(c.created_at)}</dd></div>
              </dl>
              <div className="row wrap">
                {!c.is_default && (
                  <button className="btn btn-line btn-sm" onClick={() => act(`/app/channels/${c.id}/default`, "POST", "Default channel updated")}>
                    Make default
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (confirm(`Remove ${c.kind === "till" ? "Till" : "Paybill"} ${c.shortcode}?`)) act(`/app/channels/${c.id}`, "DELETE", "Channel removed");
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <section className="panel rise">
          <Empty
            icon="channel"
            title="No Till or Paybill yet"
            body="Payments you request go straight into it."
            action={approved ? <button className="btn btn-pine" onClick={() => open("channel")}>Add Till or Paybill</button> : undefined}
          />
        </section>
      )}
    </>
  );
}
