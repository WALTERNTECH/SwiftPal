"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { AdjustModal, ResolveModal } from "@/components/money";
import { Empty, KV, Modal, PageHeader, useToast } from "@/components/ui";
import { api, invalidate, useApi, type ApiError, type AuditRow, type Balances, type Payment, type Payout } from "@/lib/api";
import { actionLabel, dateTime, KYC, money, money2, timeAgo } from "@/lib/format";

type Detail = {
  merchant: { id: string; name: string; type: string; account_code: string; industry: string | null; website: string | null; verification_status: string; live_enabled: boolean; suspended_at: string | null; suspended_reason: string | null; auto_cover: boolean; created_at: string };
  users: { id: string; email: string; phone: string; first_name: string; last_name: string; role: string; created_at: string }[];
  balances: { live: Balances };
  channels: { id: string; kind: string; shortcode: string; account_number: string | null; display_name: string; is_default: boolean; created_at: string }[];
  keys: { id: string; name: string; mode: string; masked: string; scopes: string[]; created_at: string; last_used_at: string | null }[];
  verification: { id: string; status: string; kind: string; submitted_at: string } | null;
  payments: Payment[];
  payouts: Payout[];
  ledger: { id: string; account: string; kind: string; amount: number; ref: string | null; created_at: string }[];
  audit: AuditRow[];
};

const TABS = ["Payments", "Payouts", "Ledger", "API keys", "Audit"] as const;

export default function MerchantPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data: d, error } = useApi<Detail>(`/merchants/${id}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Payments");
  const [adjusting, setAdjusting] = useState(false);
  const [resolving, setResolving] = useState<{ kind: "payment" | "payout"; item: Payment | Payout } | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    try {
      await api(path, { body });
      await invalidate(`/merchants/${id}`, "/merchants", "/overview", "/audit");
      toast(done);
      setSuspending(false);
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
    setBusy(false);
  }

  if (!d) {
    return (
      <>
        <PageHeader title="Merchant" />
        <section className="panel">
          <div className="empty">{error ? <p className="muted">{error.message}</p> : <span className="spinner" />}</div>
        </section>
      </>
    );
  }

  const m = d.merchant;
  const owner = d.users.find((u) => u.role === "owner") ?? d.users[0];
  const b = d.balances.live;

  return (
    <>
      <PageHeader
        title={m.name}
        sub={
          <>
            <span className="mono">{m.account_code}</span> · {m.type} · joined {dateTime(m.created_at)}{" "}
            {m.suspended_at ? <span className="badge bad">Suspended</span> : <span className={`badge ${KYC[m.verification_status]?.[0] ?? ""}`}>{KYC[m.verification_status]?.[1]}</span>}
          </>
        }
        actions={
          <>
            {d.verification && (
              <Link href={`/verifications/${d.verification.id}`} className="btn btn-line">
                <Icon name="shield" size={15} /> Verification
              </Link>
            )}
            {m.suspended_at ? (
              <button className="btn btn-line" disabled={busy} onClick={() => act(`/merchants/${id}/unsuspend`, {}, "Suspension lifted")}>
                Lift suspension
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => setSuspending(true)}>
                Suspend
              </button>
            )}
            <button className="btn btn-pine" onClick={() => setAdjusting(true)}>
              Adjust balance
            </button>
          </>
        }
      />

      {m.suspended_at && (
        <div className="callout warn">
          <Icon name="alert" size={16} />
          <span>
            <b>Suspended {timeAgo(m.suspended_at)}.</b> {m.suspended_reason}
          </span>
        </div>
      )}

      <div className="cards">
        <div className="card-stat">
          <span>Fee credit</span>
          <b>{money2(b.fee_credit.available)}</b>
          <em>{b.fee_credit.held > 0 ? `${money2(b.fee_credit.held)} held` : "Nothing held"}</em>
        </div>
        <div className="card-stat">
          <span>Payout float</span>
          <b>{money2(b.payout_float.available)}</b>
          <em>{b.payout_float.held > 0 ? `${money2(b.payout_float.held)} in flight` : "Nothing in flight"}</em>
        </div>
        <div className="card-stat">
          <span>Live</span>
          <b>{m.live_enabled ? "On" : "Off"}</b>
          <em>Auto-cover {m.auto_cover ? "on" : "off"}</em>
        </div>
      </div>

      <div className="grid-2 grid-even">
        <section className="panel">
          <div className="panel-head"><h3>Account holder</h3></div>
          <div className="panel-body">
            <KV
              rows={[
                ["Name", `${owner?.first_name ?? ""} ${owner?.last_name ?? ""}`],
                ["Email", owner?.email ?? "—"],
                ["Phone", <span key="p" className="mono">{owner?.phone ?? "—"}</span>],
                ["Industry", m.industry ?? "—"],
                ["Website", m.website || "—"],
              ]}
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Tills and Paybills</h3></div>
          {d.channels.length ? (
            <div className="health">
              {d.channels.map((c) => (
                <div key={c.id}>
                  <span>
                    <b className="mono">{c.shortcode}</b> <span className="muted">{c.kind === "till" ? "Till" : `Paybill · ${c.account_number}`}</span>
                    <div className="muted" style={{ fontSize: 12 }}>{c.display_name}</div>
                  </span>
                  {c.is_default && <span className="badge pine">Default</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-body muted" style={{ fontSize: 13.5 }}>None added.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="toolbar">
          <div className="seg-tabs" role="group">
            {TABS.map((t) => (
              <button key={t} aria-current={tab === t} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {tab === "Payments" &&
          (d.payments.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="right">Amount</th><th>Type</th><th>Status</th><th>Phone</th><th>Reference</th><th>Receipt</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {d.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="right num">{money(p.amount)}</td>
                      <td className="muted">{p.purpose === "topup" ? "Top-up" : "Payment"}</td>
                      <td><span className={`badge ${p.status === "succeeded" ? "ok" : p.status === "pending" ? "info" : "warn"}`}>{p.status}</span></td>
                      <td className="mono">{p.phone}</td>
                      <td className="mono">{p.reference}</td>
                      <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                      <td className="muted">{dateTime(p.created_at)}</td>
                      <td className="right">{p.status !== "succeeded" && <button className="btn btn-line btn-sm" onClick={() => setResolving({ kind: "payment", item: { ...p, merchant_name: m.name } })}>Resolve</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="collect" title="No live payments" body="" />
          ))}

        {tab === "Payouts" &&
          (d.payouts.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="right">Amount</th><th>Type</th><th>Status</th><th>Recipient</th><th>Reference</th><th>Receipt</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {d.payouts.map((p) => (
                    <tr key={p.id}>
                      <td className="right num">{money(p.amount)}</td>
                      <td className="muted">{p.purpose === "withdrawal" ? "Withdrawal" : "Payout"}</td>
                      <td><span className={`badge ${p.status === "succeeded" ? "ok" : p.status === "processing" ? "info" : "bad"}`}>{p.status}</span></td>
                      <td className="mono">{p.phone}</td>
                      <td className="mono">{p.reference}</td>
                      <td className="mono">{p.mpesa_receipt ?? <span className="dim">—</span>}</td>
                      <td className="muted">{dateTime(p.created_at)}</td>
                      <td className="right">
                        {p.status === "processing" && (
                          <button className="btn btn-line btn-sm" onClick={() => setResolving({ kind: "payout", item: { ...p, merchant_name: m.name } })}>
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="payout" title="No live payouts" body="" />
          ))}

        {tab === "Ledger" &&
          (d.ledger.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Entry</th><th>Balance</th><th>Reference</th><th className="right">Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {d.ledger.map((l) => (
                    <tr key={l.id}>
                      <td style={{ textTransform: "capitalize" }}>{l.kind.replace("_", " ")}</td>
                      <td className="muted">{l.account === "fee" ? "Fee credit" : "Payout float"}</td>
                      <td className="mono">{l.ref ?? <span className="dim">—</span>}</td>
                      <td className="right num" style={{ color: l.amount >= 0 ? "var(--ok)" : "var(--ink)" }}>{l.amount >= 0 ? "+" : "−"}{money2(Math.abs(l.amount)).replace("KES ", "")}</td>
                      <td className="muted">{dateTime(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="receipt" title="No ledger entries" body="" />
          ))}

        {tab === "API keys" &&
          (d.keys.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th /></tr></thead>
                <tbody>
                  {d.keys.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name} <span className="dim">· {k.mode}</span></td>
                      <td className="mono">{k.masked}</td>
                      <td className="muted">{k.scopes.join(", ")}</td>
                      <td className="muted">{k.last_used_at ? timeAgo(k.last_used_at) : "Never"}</td>
                      <td className="right">
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} disabled={busy} onClick={() => confirm(`Revoke "${k.name}"? The merchant's integration using it stops working.`) && act(`/keys/${k.id}/revoke`, {}, "Key revoked")}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="key" title="No API keys" body="" />
          ))}

        {tab === "Audit" &&
          (d.audit.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
                <tbody>
                  {d.audit.map((a) => (
                    <tr key={a.id}>
                      <td className="muted">{dateTime(a.created_at)}</td>
                      <td>{a.admin_name ?? "System"}</td>
                      <td>{actionLabel(a.action)}</td>
                      <td className="json">{JSON.stringify(a.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="logs" title="No admin actions yet" body="" />
          ))}
      </section>

      <AdjustModal merchantId={id} open={adjusting} onClose={() => setAdjusting(false)} />
      <ResolveModal kind={resolving?.kind ?? "payment"} item={resolving?.item ?? null} onClose={() => setResolving(null)} />
      <Modal
        open={suspending}
        onClose={() => setSuspending(false)}
        title={`Suspend ${m.name}`}
        footer={
          <>
            <button className="btn btn-line" onClick={() => setSuspending(false)}>Cancel</button>
            <button className="btn btn-danger" disabled={busy || reason.trim().length < 5} onClick={() => act(`/merchants/${id}/suspend`, { reason: reason.trim() }, "Account suspended")}>
              Suspend
            </button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 13.5 }}>Their API keys stop working, and no payments, payouts or withdrawals go through until you lift it.</p>
        <div className="field">
          <label className="label" htmlFor="sus">Reason</label>
          <textarea id="sus" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
