"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTime, money, money2 } from "@/lib/format";

type Overview = {
  merchants: { total: number; week: number; submitted: number; approved: number; suspended: number };
  payments: { today: { amount: number; count: number }; week: { amount: number; count: number; success_rate: number | null } };
  payouts: { week: { amount: number; count: number; failed: number } };
  fees: { week: number; month: number; all: number };
  holdings: { payout_float: number; fee_credit: number };
  attention: { kyc: number; stuck_payments: number; stuck_payouts: number; failed_webhooks: number };
  system: Record<string, boolean | string>;
  risk: {
    near_limit: { id: string; name: string; sent_today: number; limit: number }[];
    large_payouts: { id: string; merchant_id: string; name: string; amount: number; phone: string; status: string; created_at: string }[];
    failed_sign_ins: { id: string; name: string; failures: number }[];
  };
  platform: { payouts_paused: boolean; payments_paused: boolean; signups_paused: boolean; announcement: { text: string } | null };
};

export default function OverviewPage() {
  const { data: o, error } = useApi<Overview>("/overview", { refreshMs: 30_000 });

  if (!o) {
    return (
      <>
        <PageHeader title="Overview" />
        <section className="panel">
          <div className="empty">{error ? <p className="muted">{error.message}</p> : <span className="spinner" />}</div>
        </section>
      </>
    );
  }

  const attention = [
    { n: o.attention.kyc, t: "Verifications to review", href: "/verifications" },
    { n: o.attention.stuck_payments, t: "Payments stuck over 10 minutes", href: "/payments?stuck=1" },
    { n: o.attention.stuck_payouts, t: "Payouts stuck over 10 minutes", href: "/payouts?stuck=1" },
    { n: o.attention.failed_webhooks, t: "Webhook deliveries failed today", href: "/merchants" },
  ];

  return (
    <>
      <PageHeader title="Overview" sub="Live mode" />

      {(o.platform.payouts_paused || o.platform.payments_paused || o.platform.signups_paused) && (
        <Link href="/system" className="callout warn">
          <b>Paused:</b>
          <span className="grow">
            {[o.platform.payouts_paused && "payouts and withdrawals", o.platform.payments_paused && "payment prompts", o.platform.signups_paused && "sign-ups"].filter(Boolean).join(", ")}
          </span>
          <span className="link">Platform switches</span>
        </Link>
      )}

      <div className="cards">
        {attention.map((a) => (
          <Link key={a.t} href={a.href} className={`card-stat ${a.n > 0 ? "alert" : ""}`}>
            <span>{a.t}</span>
            <b>{a.n}</b>
          </Link>
        ))}
      </div>

      <div className="cards">
        <div className="card-stat">
          <span>Collected today</span>
          <b>{money(o.payments.today.amount)}</b>
          <em>{o.payments.today.count} payments</em>
        </div>
        <div className="card-stat">
          <span>Collected · 7 days</span>
          <b>{money(o.payments.week.amount)}</b>
          <em>{o.payments.week.success_rate === null ? "No settled prompts" : `${(o.payments.week.success_rate * 100).toFixed(1)}% success`}</em>
        </div>
        <div className="card-stat">
          <span>Paid out · 7 days</span>
          <b>{money(o.payouts.week.amount)}</b>
          <em>
            {o.payouts.week.count} sent · {o.payouts.week.failed} failed
          </em>
        </div>
        <div className="card-stat">
          <span>Fees earned · 7 days</span>
          <b>{money2(o.fees.week)}</b>
          <em>
            {money2(o.fees.month)} in 30 days · {money2(o.fees.all)} all time
          </em>
        </div>
      </div>

      {(o.risk.near_limit.length > 0 || o.risk.large_payouts.length > 0 || o.risk.failed_sign_ins.length > 0) && (
        <section className="panel">
          <div className="panel-head"><h3>Risk</h3><span className="muted" style={{ fontSize: 12.5 }}>Worth a look today</span></div>
          <div className="health">
            {o.risk.failed_sign_ins.map((r) => (
              <Link key={`f${r.id}`} href={`/merchants/${r.id}`}>
                <span><b style={{ fontWeight: 500 }}>{r.name}</b> <span className="muted">· {r.failures} wrong passwords in the last hour</span></span>
                <span className="badge bad">Password attack?</span>
              </Link>
            ))}
            {o.risk.near_limit.map((r) => (
              <Link key={`n${r.id}`} href={`/merchants/${r.id}`}>
                <span><b style={{ fontWeight: 500 }}>{r.name}</b> <span className="muted">· {money(r.sent_today)} of {money(r.limit)} daily limit sent</span></span>
                <span className="badge warn">Near limit</span>
              </Link>
            ))}
            {o.risk.large_payouts.map((r) => (
              <Link key={`l${r.id}`} href={`/merchants/${r.merchant_id}`}>
                <span><b style={{ fontWeight: 500 }}>{r.name}</b> <span className="muted">· {money(r.amount)} to <span className="mono">{r.phone}</span> · {dateTime(r.created_at)}</span></span>
                <span className="badge info">Large payout</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid-2 grid-even">
        <section className="panel">
          <div className="panel-head">
            <h3>Merchants</h3>
            <Link href="/merchants" className="link" style={{ fontSize: 12.5 }}>
              All merchants
            </Link>
          </div>
          <div className="health">
            <div><span>Total</span><b className="num">{o.merchants.total}</b></div>
            <div><span>Joined this week</span><b className="num">{o.merchants.week}</b></div>
            <div><span>Verified</span><b className="num">{o.merchants.approved}</b></div>
            <div><span>Under review</span><b className="num">{o.merchants.submitted}</b></div>
            <div><span>Suspended</span><b className="num">{o.merchants.suspended}</b></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Money held for merchants</h3>
          </div>
          <div className="health">
            <div><span>Payout float</span><b className="num">{money2(o.holdings.payout_float)}</b></div>
            <div><span>Fee credit</span><b className="num">{money2(o.holdings.fee_credit)}</b></div>
          </div>
          <div className="panel-head" style={{ borderTop: "1px solid var(--line)" }}>
            <h3>System</h3>
            <Link href="/system" className="link" style={{ fontSize: 12.5 }}>
              Details
            </Link>
          </div>
          <div className="health">
            <Check ok={!!o.system.live_mpesa} t="Live M-Pesa (Daraja)" />
            <Check ok={!!o.system.email} t="Email" />
            <Check ok={!!o.system.sms} t="SMS" />
          </div>
        </section>
      </div>
    </>
  );
}

function Check({ ok, t }: { ok: boolean; t: string }) {
  return (
    <div>
      <span>{t}</span>
      <span className={`badge ${ok ? "ok" : "warn"}`}>{ok ? "Connected" : "Not set up"}</span>
    </div>
  );
}
