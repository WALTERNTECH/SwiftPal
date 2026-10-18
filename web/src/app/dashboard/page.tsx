"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { AreaChart, CountUp, Delta, kes, Sparkline, SuccessRing } from "@/components/dash/charts";
import { can, useAccount, useApi, useMode, usePayments, usePayouts, type Analytics, type ApiKey, type Endpoint, type Summary } from "@/lib/api";
import { dayLabel, delta, maskPhone, money, timeAgo } from "@/lib/format";

type Range = 7 | 14 | 30;

const ZERO: Summary = { collected: 0, paid_out: 0, successful: 0, prompts: 0, settled: 0, success_rate: null, average_ticket: null, fees: 0, payouts: 0, payouts_failed: 0 };

export default function Overview() {
  const me = useAccount();
  const mode = useMode();
  const { open, showPayment } = useActions();
  const [range, setRange] = useState<Range>(14);
  const { data: week } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=7`);
  const { data: span } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=${range}`);
  const { data: payments = [], loading } = usePayments(mode);
  const { data: payouts = [] } = usePayouts(mode);
  // Keys and webhooks carry secrets, so only roles that manage them load them.
  const dev = can(me, "developers");
  const { data: hooks = [] } = useApi<Endpoint[]>(dev ? `/app/webhooks?mode=${mode}` : null);
  const { data: keys = [] } = useApi<ApiKey[]>(dev ? "/app/keys" : null);
  const bal = me.balances[mode];
  const cur = week?.current ?? ZERO;
  const prev = week?.previous ?? ZERO;
  const spark = (k: "collected" | "paid_out" | "successful") => (week?.series ?? []).map((d) => d[k]);

  const vs = me.merchant.verification_status;
  const approved = vs === "approved";
  const hasChannel = me.channels.length > 0;
  // In order: each step opens once the one before it is done.
  const setup: { t: string; sub?: string; done: boolean; locked?: boolean; href?: string; act?: () => void }[] = [
    { t: "Business details", done: !!me.merchant.industry, href: "/dashboard/settings?tab=business" },
    { t: "Verify your identity", sub: vs === "submitted" ? "Under review" : vs === "rejected" ? "Unsuccessful" : undefined, done: approved, href: "/dashboard/verification" },
    { t: "Add your Till or Paybill", done: hasChannel, locked: !approved, act: () => open("channel") },
    { t: "Create an API key", done: keys.some((k) => k.mode === "live"), locked: !approved, href: "/dashboard/developers" },
    { t: "Add a webhook", done: hooks.length > 0, locked: !approved, href: "/dashboard/developers/webhooks" },
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

  return (
    <>
      <div className="page-header rise">
        <div>
          <h1>
            {greeting}, {me.user.first_name}
          </h1>
          <p className="muted">Last 7 days compared with the 7 before</p>
        </div>
        <div className="row wrap">
          <button className="btn btn-line" onClick={() => open("payout")} disabled={!approved}>
            <Icon name="payout" size={15} /> Send payout
          </button>
          <button className="btn btn-pine" onClick={() => open("payment")} disabled={!hasChannel}>
            <Icon name="collect" size={15} /> Request payment
          </button>
        </div>
      </div>

      <div className="grid-2">
        <section className="bal-hero rise" style={{ ["--d" as string]: "40ms" }}>
          <div className="bal-top">
            <span className="eyebrow">Balances</span>
            <span className={`bal-chip ${hasChannel ? "" : "off"}`}>
              <i /> {hasChannel ? "Receiving payments" : "Not receiving yet"}
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
          {can(me, "money") && (
            <div className="bal-actions">
              <button className="btn btn-pine" onClick={() => open("topup-fee")}>
                <Icon name="plus" size={14} /> Top up
              </button>
              <button className="btn btn-line" onClick={() => open("topup-float")}>Fund float</button>
              <button className="btn btn-line" onClick={() => open("withdraw")}>Withdraw</button>
            </div>
          )}
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
            {setup.map((x) => {
              const body = (
                <>
                  <span className="setup-mark">{x.done && <Icon name="check" size={11} strokeWidth={2.6} />}</span>
                  <span className="grow">{x.t}</span>
                  {x.sub && !x.done && <span className="setup-sub">{x.sub}</span>}
                  {!x.done && !x.locked && <Icon name="chevronRight" size={14} className="dim" />}
                </>
              );
              if (x.done) return <div key={x.t} className="setup-item done">{body}</div>;
              if (x.locked) return <div key={x.t} className="setup-item locked">{body}</div>;
              if (x.act) return <button key={x.t} className="setup-item" onClick={x.act}>{body}</button>;
              return <Link key={x.t} href={x.href!} className="setup-item">{body}</Link>;
            })}
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
              <p className="muted">Payments into your Till or Paybill appear here.</p>
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
