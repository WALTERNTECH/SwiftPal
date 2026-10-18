"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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
  people: { id: string; email: string; phone: string; first_name: string; last_name: string; role: string; two_factor: boolean; disabled_at: string | null; last_active_at: string | null; sessions: number }[];
  activity: { kind: string; detail: Record<string, unknown>; ip: string | null; created_at: string; email: string | null }[];
  links: { id: string; url: string; title: string; amount: number | null; active: boolean; paid: number; created_at: string }[];
  notes: { id: number; body: string; created_at: string; admin_name: string | null }[];
  terms: { payout_daily_limit: number | null; default_payout_daily_limit: number; sent_today: number; stk_fee: number | null; b2c_fee_pct: number | null };
};

const TABS = ["Payments", "Payouts", "Ledger", "People", "Security", "Links", "API keys", "Audit"] as const;
const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", developer: "Developer", finance: "Finance", support: "Support" };

export default function MerchantPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data: d, error } = useApi<Detail>(`/merchants/${id}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Payments");
  const [adjusting, setAdjusting] = useState(false);
  const [resolving, setResolving] = useState<{ kind: "payment" | "payout"; item: Payment | Payout } | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [terms, setTerms] = useState(false);
  const [note, setNote] = useState("");
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
            <button className="btn btn-line" onClick={() => setTerms(true)}>
              Limits and pricing
            </button>
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
        <div className="card-stat">
          <span>Daily payout limit {d.terms.payout_daily_limit === null && <span className="dim">· default</span>}</span>
          <b>{money(d.terms.payout_daily_limit ?? d.terms.default_payout_daily_limit)}</b>
          <em>{money(d.terms.sent_today)} sent today</em>
        </div>
        <div className="card-stat">
          <span>Pricing</span>
          <b>{d.terms.stk_fee === null && d.terms.b2c_fee_pct === null ? "Standard" : "Custom"}</b>
          <em>
            STK {d.terms.stk_fee === null ? "KES 2.50" : money2(d.terms.stk_fee)} · B2C {d.terms.b2c_fee_pct === null ? "standard" : `${d.terms.b2c_fee_pct}%`}
          </em>
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
        <div className="panel-head"><h3>Internal notes</h3><span className="muted" style={{ fontSize: 12.5 }}>Only admins see these</span></div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <textarea className="textarea grow" rows={2} placeholder="Called about a missing top-up. Confirmed receipt TJG4K2XQ8P with Safaricom." value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-line" disabled={busy || note.trim().length < 2} onClick={() => act(`/merchants/${id}/notes`, { body: note.trim() }, "Note added").then(() => setNote(""))}>
              Add note
            </button>
          </div>
          {d.notes.map((n) => (
            <div key={n.id} className="note-row">
              <p>{n.body}</p>
              <span className="muted">{n.admin_name ?? "Admin"} · {dateTime(n.created_at)}</span>
            </div>
          ))}
        </div>
      </section>

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

        {tab === "People" && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Person</th><th>Role</th><th>Two-step</th><th>Last active</th><th>Sessions</th><th /></tr></thead>
                <tbody>
                  {d.people.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b style={{ fontWeight: 500 }}>{u.first_name} {u.last_name}</b>
                        <div className="dim" style={{ fontSize: 12 }}>{u.email} · <span className="mono">{u.phone}</span></div>
                      </td>
                      <td>{u.disabled_at ? <span className="badge">Removed</span> : <span className={`badge ${u.role === "owner" ? "pine" : ""}`}>{ROLE[u.role] ?? u.role}</span>}</td>
                      <td>{u.two_factor ? <span className="badge ok">On</span> : <span className="badge warn">Off</span>}</td>
                      <td className="muted">{u.last_active_at ? timeAgo(u.last_active_at) : "—"}</td>
                      <td className="num">{u.sessions}</td>
                      <td className="right">
                        {u.two_factor && !u.disabled_at && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() =>
                              confirm(`Reset two-step verification for ${u.first_name}? Only do this after confirming who they are by phone or video. They're signed out and set it up again.`) &&
                              act(`/merchants/${id}/users/${u.id}/reset-2fa`, {}, "Two-step verification reset")
                            }
                          >
                            Reset 2FA
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="toolbar" style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>
              <span className="muted grow" style={{ fontSize: 13 }}>Suspect a takeover? Sign everyone out; they need their password (and two-step code) again.</span>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => confirm(`Sign out everyone on ${m.name}?`) && act(`/merchants/${id}/sign-out`, {}, "Everyone signed out")}>
                Sign out everywhere
              </button>
            </div>
          </>
        )}

        {tab === "Security" &&
          (d.activity.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th><th>Details</th></tr></thead>
                <tbody>
                  {d.activity.map((a, i) => (
                    <tr key={i}>
                      <td className="muted">{dateTime(a.created_at)}</td>
                      <td>{a.email ?? <span className="dim">SwiftPal</span>}</td>
                      <td>
                        <span className={`badge ${/failed|disabled|removed|reset/.test(a.kind) ? "bad" : /password|phone|withdrawal|connect/.test(a.kind) ? "warn" : ""}`}>{a.kind.replace(/_/g, " ")}</span>
                      </td>
                      <td className="mono muted">{a.ip ?? ""}</td>
                      <td className="json">{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="shield" title="No security activity" body="" />
          ))}

        {tab === "Links" &&
          (d.links.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Link</th><th className="right">Price</th><th className="right">Paid</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  {d.links.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.title}
                        <div className="dim mono" style={{ fontSize: 11.5 }}>{l.url}</div>
                      </td>
                      <td className="right num">{l.amount === null ? <span className="muted">Any</span> : money(l.amount)}</td>
                      <td className="right num">{l.paid}</td>
                      <td>{l.active ? <span className="badge ok">On</span> : <span className="badge">Off</span>}</td>
                      <td className="muted">{timeAgo(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="link" title="No payment links" body="" />
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
      <TermsModal merchantId={id} open={terms} onClose={() => setTerms(false)} current={d.terms} />
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

/** Risk limits and negotiated prices. Empty fields go back to the platform defaults. */
function TermsModal({ merchantId, open, onClose, current }: { merchantId: string; open: boolean; onClose: () => void; current: Detail["terms"] }) {
  const toast = useToast();
  const [f, setF] = useState({ limit: "", stk: "", pct: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setF({ limit: current.payout_daily_limit === null ? "" : String(current.payout_daily_limit), stk: current.stk_fee === null ? "" : String(current.stk_fee), pct: current.b2c_fee_pct === null ? "" : String(current.b2c_fee_pct) });
      setError("");
    }
  }, [open, current]);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Limits and pricing"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-pine"
            disabled={busy}
            onClick={async () => {
              const body = { payout_daily_limit: num(f.limit), stk_fee: num(f.stk), b2c_fee_pct: num(f.pct) };
              if (Object.values(body).some((v) => v !== null && (!Number.isFinite(v) || v < 0))) return setError("Use positive numbers, or leave a field empty for the default.");
              setBusy(true);
              setError("");
              try {
                await api(`/merchants/${merchantId}/terms`, { method: "PATCH", body });
                await invalidate(`/merchants/${merchantId}`, "/audit");
                toast("Saved. It applies to their next request.");
                onClose();
              } catch (e) {
                setError((e as ApiError).message);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : "Save"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="t-limit">Daily payout limit</label>
        <div className="input-group">
          <span className="prefix">KES</span>
          <input id="t-limit" className="input mono" inputMode="numeric" placeholder={`${current.default_payout_daily_limit.toLocaleString()} (default)`} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/[^0-9]/g, "") })} />
        </div>
        <span className="hint">Live payouts, refunds and withdrawals per Nairobi day. 0 stops money leaving entirely.</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="t-stk">STK Push fee</label>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input id="t-stk" className="input mono" inputMode="decimal" placeholder="2.50 (standard)" value={f.stk} onChange={(e) => setF({ ...f, stk: e.target.value.replace(/[^0-9.]/g, "") })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="t-pct">B2C fee, % of standard</label>
          <div className="input-group">
            <input id="t-pct" className="input mono" inputMode="numeric" placeholder="100 (standard)" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} />
            <span className="prefix">%</span>
          </div>
        </div>
      </div>
      <p className="hint">Every change goes on the audit log with the old and new values.</p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
