"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { NewPaymentModal, PaymentDrawer, TopUpModal } from "@/components/dash/modals";
import { PageHeader, PayBadge } from "@/components/dash/ui";
import { VolumeChart } from "@/components/dash/VolumeChart";
import { maskPhone, money, money2, num, timeAgo } from "@/lib/format";
import { setMode, useStore } from "@/lib/store";

const WEEK = 7 * 86_400_000;

export default function Home() {
  const s = useStore();
  const [topUp, setTopUp] = useState<"fee" | "float" | null>(null);
  const [newPay, setNewPay] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const mode = s.mode;
  const payments = useMemo(() => s.payments.filter((p) => p.mode === mode), [s.payments, mode]);
  const payouts = useMemo(() => s.payouts.filter((p) => p.mode === mode), [s.payouts, mode]);
  const bal = s.balances[mode];

  const stats = useMemo(() => {
    const since = Date.now() - WEEK;
    const week = payments.filter((p) => new Date(p.createdAt).getTime() >= since);
    const paid = week.filter((p) => p.status === "succeeded");
    const settled = week.filter((p) => p.status !== "pending");
    const po = payouts.filter((p) => new Date(p.createdAt).getTime() >= since && p.status === "succeeded");
    const fees = paid.reduce((a, p) => a + (p.feeCharged ? p.fee : 0), 0) + po.reduce((a, p) => a + p.fee, 0);
    return {
      collected: paid.reduce((a, p) => a + p.amount, 0),
      paidCount: paid.length,
      rate: settled.length ? Math.round((paid.length / settled.length) * 100) : null,
      paidOut: po.reduce((a, p) => a + p.amount, 0),
      payoutCount: po.length,
      fees,
    };
  }, [payments, payouts]);

  const verified = s.channels.some((c) => c.status === "verified");
  const checklist = [
    { done: !!s.account?.emailVerified, t: "Verify your email", d: "Done when you signed up.", href: null },
    { done: !!s.business, t: "Add business details", d: "Name, type and expected volume.", href: "/onboarding" },
    { done: verified, t: "Verify a Till or Paybill", d: "A KES 1 prompt to your phone turns on live STK Push.", href: "/dashboard/channels" },
    { done: s.balances.live.fee > 0, t: "Fund your fee credit", d: "Top up by M-Pesa. Starter credit counts.", href: "/dashboard/wallet" },
    { done: s.webhooks.length > 0, t: "Add a webhook endpoint", d: "Get payment results pushed to your server.", href: "/dashboard/developers/webhooks" },
    { done: s.verification === "approved", t: "Enable live payouts", d: "Submit ID and KRA PIN (or CR12) for B2C.", href: "/dashboard/settings?tab=verification" },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const lowFee = bal.fee < s.lowBalanceAt;

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${s.account?.firstName ?? ""}`}
        sub={mode === "test" ? "Sandbox overview: simulated prompts, payouts and webhooks." : "Live overview for the last 7 days."}
        actions={
          <>
            <Link href="/dashboard/payouts" className="btn btn-line">
              <Icon name="payout" size={15} /> Send payout
            </Link>
            <button className="btn btn-ink" onClick={() => setNewPay(true)}>
              <Icon name="collect" size={15} /> {mode === "test" ? "Test STK Push" : "Request payment"}
            </button>
          </>
        }
      />

      {doneCount < checklist.length && (
        <section className="panel">
          <div className="panel-head">
            <div className="grow">
              <h3>Go live checklist</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                {doneCount} of {checklist.length} done. {verified ? "Live STK Push is on." : "Live STK Push turns on once a channel is verified."}
              </p>
            </div>
            <div style={{ width: 140 }} className="progress" aria-hidden>
              <i style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
            </div>
          </div>
          <div className="checklist">
            {checklist.map((c) => (
              <div key={c.t} className={`check-item ${c.done ? "done" : ""}`}>
                <span className="check-mark">{c.done && <Icon name="check" size={12} strokeWidth={2.4} />}</span>
                <div>
                  <b>{c.t}</b>
                  <span className="d">{c.d}</span>
                </div>
                {!c.done && c.href && (
                  <Link href={c.href} className="btn btn-line btn-sm">
                    Start
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="balances">
        <div className="panel balance">
          <div className="spread">
            <span className="muted" style={{ fontSize: 13.5 }}>Fee credit</span>
            {lowFee ? <span className="badge warn">Below KES {num(s.lowBalanceAt)}</span> : <span className="badge plain">Pays fees</span>}
          </div>
          <div className="balance-amt"><small>KES</small>{bal.fee.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="spread wrap">
            <div className="balance-meta">
              <span>≈ <b>{num(Math.floor(bal.fee / 2.5))}</b> paid prompts</span>
              <span>Auto-cover <b>{s.autoCover ? "on" : "off"}</b></span>
            </div>
            <button className="btn btn-line btn-sm" onClick={() => setTopUp("fee")}><Icon name="plus" size={14} /> Top up</button>
          </div>
        </div>
        <div className="panel balance">
          <div className="spread">
            <span className="muted" style={{ fontSize: 13.5 }}>Payout float</span>
            <span className="badge pine">Withdrawable</span>
          </div>
          <div className="balance-amt"><small>KES</small>{bal.float.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="spread wrap">
            <div className="balance-meta">
              <span>Paid out 7d <b>{money(stats.paidOut)}</b></span>
            </div>
            <button className="btn btn-line btn-sm" onClick={() => setTopUp("float")}><Icon name="plus" size={14} /> Top up</button>
          </div>
        </div>
      </section>

      <dl className="kpis">
        <div className="kpi">
          <dt>Collected · 7 days</dt>
          <dd>{money(stats.collected)}</dd>
          <span className="sub">{num(stats.paidCount)} payments</span>
        </div>
        <div className="kpi">
          <dt>Prompt success rate</dt>
          <dd>{stats.rate === null ? "—" : `${stats.rate}%`}</dd>
          <span className="sub">of settled prompts</span>
        </div>
        <div className="kpi">
          <dt>Paid out · 7 days</dt>
          <dd>{money(stats.paidOut)}</dd>
          <span className="sub">{num(stats.payoutCount)} payouts</span>
        </div>
        <div className="kpi">
          <dt>Fees · 7 days</dt>
          <dd>{money2(stats.fees)}</dd>
          <span className="sub">only on completed transactions</span>
        </div>
      </dl>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h3>Collected per day</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>Last 14 days · successful only</span>
          </div>
          {payments.length ? (
            <VolumeChart payments={payments} />
          ) : (
            <div className="empty">
              <b>No payments yet</b>
              <p className="muted">
                {mode === "live" ? (
                  <>Live payments will show here. <button className="link" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => setMode("test")}>Switch to test mode</button> to see the sandbox.</>
                ) : (
                  "Send a test STK Push to see it here."
                )}
              </p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Recent payments</h3>
            <Link href="/dashboard/payments" className="link" style={{ fontSize: 13 }}>View all</Link>
          </div>
          {payments.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {payments.slice(0, 7).map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setOpenId(p.id)}>
                      <td>
                        <div className="num">{money(p.amount)}</div>
                        <div className="dim mono" style={{ fontSize: 12 }}>{maskPhone(p.phone)}</div>
                      </td>
                      <td><PayBadge s={p.status} /></td>
                      <td className="right muted" style={{ fontSize: 12.5 }}>{timeAgo(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <p className="muted">Nothing yet.</p>
            </div>
          )}
        </section>
      </div>

      <TopUpModal open={topUp !== null} initial={topUp ?? "fee"} onClose={() => setTopUp(null)} />
      <NewPaymentModal open={newPay} onClose={() => setNewPay(false)} onCreated={setOpenId} />
      <PaymentDrawer payment={s.payments.find((p) => p.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
