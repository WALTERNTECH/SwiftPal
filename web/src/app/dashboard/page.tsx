"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { AreaChart, CountUp, Delta, kes, Sparkline, SuccessRing } from "@/components/dash/charts";
import { useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, useApi, useMode, usePayments, usePayouts, type Analytics, type Endpoint, type Summary } from "@/lib/api";
import { dayLabel, delta, maskPhone, money, timeAgo } from "@/lib/format";

type Range = 7 | 14 | 30;

const ZERO: Summary = { collected: 0, paid_out: 0, successful: 0, prompts: 0, settled: 0, success_rate: null, average_ticket: null, fees: 0, payouts: 0, payouts_failed: 0 };

export default function Overview() {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const { open, showPayment } = useActions();
  const [range, setRange] = useState<Range>(14);
  const [seeding, setSeeding] = useState(false);
  const { data: week } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=7`);
  const { data: span } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=${range}`);
  const { data: payments = [], loading } = usePayments(mode);
  const { data: payouts = [] } = usePayouts(mode);
  const { data: hooks = [] } = useApi<Endpoint[]>(`/app/webhooks?mode=${mode}`);
  const bal = me.balances[mode];
  const cur = week?.current ?? ZERO;
  const prev = week?.previous ?? ZERO;
  const spark = (k: "collected" | "paid_out" | "successful") => (week?.series ?? []).map((d) => d[k]);

  const verified = me.channels.some((c) => c.status === "verified");
  const setup = [
    { done: !!me.merchant.industry, t: "Business details", href: "/dashboard/settings" },
    { done: verified, t: "Verify a Till or Paybill", href: "/dashboard/channels" },
    { done: me.balances.live.fee_credit.available > 0, t: "Fund fee credit", href: "/dashboard/wallet" },
    { done: hooks.length > 0, t: "Add a webhook", href: "/dashboard/developers/webhooks" },
    { done: me.merchant.verification_status === "approved", t: "Account verification", href: "/dashboard/verification" },
  ];
  const doneCount = setup.filter((x) => x.done).length;

  const feed = useMemo(() => {
    type Row = { id: string; icon: IconName; tone: string; title: string; sub: string; amount: string; in: boolean; at: string; pay?: boolean };
    const rows: Row[] = [
      ...payments.slice(0, 12).map<Row>((p) => ({
        id: p.id,
        icon: "collect",
        tone: p.status === "succeeded" ? "ok" : p.status === "pending" ? "blue" : p.status === "cancelled" ? "warn" : "bad",
        title: p.status === "succeeded" ? `Payment from ${maskPhone(p.phone)}` : p.status === "pending" ? `Prompt sent to ${maskPhone(p.phone)}` : `Payment ${p.status}`,
        sub: p.mpesa_receipt ?? p.reference,
        amount: (p.status === "succeeded" ? "+" : "") + money(p.amount),
        in: p.status === "succeeded",
        at: p.created_at,
        pay: true,
      })),
      ...payouts.slice(0, 6).map<Row>((p) => ({
        id: p.id,
        icon: "payout",
        tone: p.status === "failed" ? "bad" : "blue",
        title: p.status === "failed" ? "Payout refunded" : `Payout to ${p.recipient_name ?? maskPhone(p.phone)}`,
        sub: p.mpesa_receipt ?? p.reference,
        amount: `−${money(p.amount)}`,
        in: false,
        at: p.created_at,
      })),
    ];
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [payments, payouts]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  const stats = [
    { label: "Collected", icon: "collect" as IconName, val: cur.collected, fmt: kes, d: delta(cur.collected, prev.collected), spark: spark("collected") },
    { label: "Paid out", icon: "payout" as IconName, val: cur.paid_out, fmt: kes, d: delta(cur.paid_out, prev.paid_out), spark: spark("paid_out"), blue: true },
    { label: "Successful payments", icon: "check" as IconName, val: cur.successful, fmt: (n: number) => String(Math.round(n)), d: delta(cur.successful, prev.successful), spark: spark("successful") },
    { label: "Fees", icon: "receipt" as IconName, val: cur.fees, fmt: (n: number) => `KES ${n.toFixed(2)}`, d: delta(cur.fees, prev.fees), spark: spark("successful"), invert: true },
  ];

  async function seed() {
    setSeeding(true);
    try {
      await api("/app/sandbox/seed", { method: "POST" });
      invalidate("/app/");
      toast("Sample history loaded");
    } catch (err) {
      toast((err as Error).message, "alert");
    }
    setSeeding(false);
  }

  return (
    <>
      <div className="page-header rise">
        <div>
          <h1>
            {greeting}, {me.user.first_name}
          </h1>
          <p className="muted">{mode === "test" ? "Sandbox" : "Live"} · last 7 days compared with the 7 before</p>
        </div>
        <div className="row wrap">
          <button className="btn btn-line" onClick={() => open("payout")}>
            <Icon name="payout" size={15} /> Send payout
          </button>
          <button className="btn btn-pine" onClick={() => open("payment")}>
            <Icon name="collect" size={15} /> {mode === "test" ? "Test STK Push" : "Request payment"}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <section className="bal-hero rise" style={{ ["--d" as string]: "40ms" }}>
          <div className="bal-orb" />
          <div className="bal-top">
            <span className="eyebrow">Balances · {mode}</span>
            <span className="bal-chip">
              <i /> {verified ? "Live STK Push on" : "Sandbox ready"}
            </span>
          </div>
          <div className="bal-grid">
            <div className="bal-item">
              <span>Fee credit</span>
              <div className="bal-amt">
                <small>KES</small>
                <CountUp value={bal.fee_credit.available} format={(n) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              </div>
              <div className="bal-meta">
                ≈ {Math.floor(bal.fee_credit.available / 2.5).toLocaleString()} paid prompts
                {bal.fee_credit.held > 0 && ` · ${money(bal.fee_credit.held)} held`}
              </div>
            </div>
            <div className="bal-item">
              <span>Payout float</span>
              <div className="bal-amt">
                <small>KES</small>
                <CountUp value={bal.payout_float.available} format={(n) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              </div>
              <div className="bal-meta">withdrawable{bal.payout_float.held > 0 && ` · ${money(bal.payout_float.held)} held`}</div>
            </div>
          </div>
          <div className="bal-actions">
            <button className="bal-btn primary" onClick={() => open("topup-fee")}>
              <Icon name="plus" size={14} /> Top up
            </button>
            <button className="bal-btn" onClick={() => open("topup-float")}>Fund float</button>
            <button className="bal-btn" onClick={() => open("withdraw")}>Withdraw</button>
          </div>
        </section>

        <section className="panel setup rise" style={{ ["--d" as string]: "80ms" }}>
          <div className="setup-top">
            <div className="setup-ring">
              <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
                <circle className="track" cx="24" cy="24" r="20" fill="none" strokeWidth="5" />
                <circle className="val" cx="24" cy="24" r="20" fill="none" strokeWidth="5" strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 * (1 - doneCount / setup.length)} />
              </svg>
              <span>{doneCount}/{setup.length}</span>
            </div>
            <div>
              <b>Account setup</b>
              <div className="muted" style={{ fontSize: 12.5 }}>{doneCount === setup.length ? "Complete" : `${setup.length - doneCount} left`}</div>
            </div>
          </div>
          <div className="setup-list">
            {setup.map((x) =>
              x.done ? (
                <div key={x.t} className="setup-item done">
                  <span className="setup-mark"><Icon name="check" size={11} strokeWidth={2.6} /></span>
                  <span className="grow">{x.t}</span>
                </div>
              ) : (
                <Link key={x.t} href={x.href} className="setup-item">
                  <span className="setup-mark" />
                  <span className="grow">{x.t}</span>
                  <Icon name="chevronRight" size={14} className="dim" />
                </Link>
              ),
            )}
          </div>
        </section>
      </div>

      <div className="stats">
        {stats.map((st, i) => (
          <div key={st.label} className="stat rise" style={{ ["--d" as string]: `${120 + i * 50}ms` }}>
            <div className="stat-label">
              <span className={`stat-ic ${st.blue ? "blue" : ""}`}>
                <Icon name={st.icon} size={13} />
              </span>
              {st.label}
            </div>
            <div className="stat-val">
              <CountUp value={st.val} format={st.fmt} />
            </div>
            <div className="stat-foot">
              <span className="row" style={{ gap: 6 }}>
                <Delta value={st.d} invert={st.invert} />
              </span>
              <Sparkline values={st.spark} blue={st.blue} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="panel rise" style={{ ["--d" as string]: "200ms" }}>
          <div className="panel-head">
            <div>
              <h3>Volume</h3>
              <div className="legend" style={{ marginTop: 4 }}>
                <span><i className="swatch s1" /> Collected <b>{money(span?.current.collected ?? 0)}</b></span>
                <span><i className="swatch s2" /> Paid out <b>{money(span?.current.paid_out ?? 0)}</b></span>
              </div>
            </div>
            <div className="range" role="group" aria-label="Range">
              {([7, 14, 30] as Range[]).map((r) => (
                <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r}d
                </button>
              ))}
            </div>
          </div>
          {span && payments.length ? (
            <AreaChart
              key={range}
              labels={span.series.map((d) => dayLabel(d.date))}
              series={[
                { key: "c", label: "Collected", cls: "s1", values: span.series.map((d) => d.collected) },
                { key: "p", label: "Paid out", cls: "s2", values: span.series.map((d) => d.paid_out) },
              ]}
            />
          ) : loading || !span ? (
            <div className="empty">
              <span className="spinner" />
            </div>
          ) : (
            <div className="empty">
              <b>No activity yet</b>
              <p className="muted">{mode === "live" ? "Live payments appear here." : "Send a test STK Push, or load sixty days of sample history."}</p>
              {mode === "test" && (
                <button className="btn btn-line btn-sm" onClick={seed} disabled={seeding}>
                  {seeding ? <span className="spinner" /> : "Load sample history"}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="panel rise" style={{ ["--d" as string]: "240ms" }}>
          <div className="panel-head">
            <h3>Prompt success</h3>
            <Link href="/dashboard/analytics" className="link" style={{ fontSize: 12.5 }}>Analytics</Link>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 18, justifyItems: "center" }}>
            <SuccessRing rate={cur.success_rate} />
            <dl className="mini-stats" style={{ width: "100%", gridTemplateColumns: "1fr 1fr", boxShadow: "none" }}>
              <div>
                <dt>Prompts</dt>
                <dd>{cur.prompts}</dd>
              </div>
              <div>
                <dt>Avg ticket</dt>
                <dd>{cur.average_ticket ? kes(cur.average_ticket) : "—"}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      <section className="panel rise" style={{ ["--d" as string]: "280ms" }}>
        <div className="panel-head">
          <h3>Recent activity</h3>
          <Link href="/dashboard/payments" className="link" style={{ fontSize: 12.5 }}>All payments</Link>
        </div>
        {feed.length ? (
          <div className="feed">
            {feed.map((f, i) => (
              <div key={f.id} className="feed-row" style={{ ["--d" as string]: `${300 + i * 40}ms` }} onClick={() => f.pay && showPayment(f.id)}>
                <span className={`feed-ic ${f.tone}`}>
                  <Icon name={f.icon} size={15} />
                </span>
                <div className="feed-t">
                  <b>{f.title}</b>
                  <span>{f.sub}</span>
                </div>
                <div className="feed-amt">
                  <b className={f.in ? "in" : ""}>{f.amount}</b>
                  <span>{timeAgo(f.at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="muted">{loading ? "Loading…" : "Nothing yet."}</p>
          </div>
        )}
      </section>
    </>
  );
}
