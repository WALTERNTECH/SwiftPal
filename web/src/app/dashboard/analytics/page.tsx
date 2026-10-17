"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { AreaChart, BarChart, CountUp, Delta, kes } from "@/components/dash/charts";
import { downloadCsv, PageHeader } from "@/components/dash/ui";
import { byHour, compare, daily, delta, outcomes, rangeStart, ticketBands, type Range } from "@/lib/analytics";
import { money, num } from "@/lib/format";
import { useStore } from "@/lib/store";

const OUT_ICON: Record<string, IconName> = { ok: "check", warn: "x", bad: "alert", "": "clock" };

export default function Analytics() {
  const s = useStore();
  const [range, setRange] = useState<Range>(30);
  const payments = useMemo(() => s.payments.filter((p) => p.mode === s.mode), [s.payments, s.mode]);
  const payouts = useMemo(() => s.payouts.filter((p) => p.mode === s.mode), [s.payouts, s.mode]);
  const from = rangeStart(range);

  const days = useMemo(() => daily(payments, payouts, range), [payments, payouts, range]);
  const { cur, prev } = useMemo(() => compare(payments, payouts, range), [payments, payouts, range]);
  const outs = useMemo(() => outcomes(payments, from), [payments, from]);
  const hours = useMemo(() => byHour(payments, from), [payments, from]);
  const bands = useMemo(() => ticketBands(payments, from), [payments, from]);
  const settled = outs.reduce((a, o) => a + o.count, 0);
  const peak = hours.reduce((m, h) => (h.count > hours[m].count ? h.h : m), 0);
  const maxBand = Math.max(...bands.map((b) => b.count), 1);

  const poRange = payouts.filter((p) => new Date(p.createdAt).getTime() >= from);
  const poFailed = poRange.filter((p) => p.status === "failed").length;
  const reasons = ["withdrawal", "salary", "refund", "commission", "promotion", "other"]
    .map((r) => ({ r, amount: poRange.filter((p) => p.reason === r && p.status === "succeeded").reduce((a, p) => a + p.amount, 0) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const maxReason = Math.max(...reasons.map((x) => x.amount), 1);

  const kpis = [
    { l: "Collected", v: cur.collected, f: kes, d: delta(cur.collected, prev.collected) },
    { l: "Successful payments", v: cur.paid, f: (n: number) => num(Math.round(n)), d: delta(cur.paid, prev.paid) },
    { l: "Success rate", v: (cur.rate ?? 0) * 100, f: (n: number) => `${n.toFixed(1)}%`, d: delta(cur.rate, prev.rate) },
    { l: "Average ticket", v: cur.avgTicket ?? 0, f: kes, d: delta(cur.avgTicket, prev.avgTicket) },
    { l: "Paid out", v: cur.paidOut, f: kes, d: delta(cur.paidOut, prev.paidOut) },
    { l: "Fees", v: cur.fees, f: (n: number) => `KES ${n.toFixed(2)}`, d: delta(cur.fees, prev.fees), invert: true },
  ];

  return (
    <>
      <PageHeader
        title="Analytics"
        sub={`${s.mode === "test" ? "Sandbox" : "Live"} · last ${range} days vs the ${range} before`}
        actions={
          <>
            <div className="range" role="group" aria-label="Range">
              {([7, 14, 30] as Range[]).map((r) => (
                <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r}d
                </button>
              ))}
            </div>
            <button
              className="btn btn-line btn-sm"
              onClick={() =>
                downloadCsv(`swiftpal-daily-${s.mode}-${range}d.csv`, [
                  ["date", "prompts", "paid", "collected_kes", "paid_out_kes", "success_rate"],
                  ...days.map((d) => [new Date(d.t).toISOString().slice(0, 10), d.prompts, d.paid, d.collected, d.paidOut, d.settled ? (d.paid / d.settled).toFixed(3) : ""]),
                ])
              }
            >
              <Icon name="download" size={14} /> Export
            </button>
          </>
        }
      />

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {kpis.map((k, i) => (
          <div key={k.l} className="stat rise" style={{ ["--d" as string]: `${i * 40}ms` }}>
            <div className="stat-label">{k.l}</div>
            <div className="stat-val" style={{ fontSize: 21 }}>
              <CountUp key={`${k.l}-${range}`} value={k.v} format={k.f} />
            </div>
            <div className="stat-foot">
              <Delta value={k.d} invert={k.invert} />
            </div>
          </div>
        ))}
      </div>

      <section className="panel rise" style={{ ["--d" as string]: "120ms" }}>
        <div className="panel-head">
          <div>
            <h3>Volume per day</h3>
            <div className="legend" style={{ marginTop: 4 }}>
              <span><i className="swatch s1" /> Collected <b>{money(cur.collected)}</b></span>
              <span><i className="swatch s2" /> Paid out <b>{money(cur.paidOut)}</b></span>
            </div>
          </div>
        </div>
        <AreaChart
          key={`v${range}`}
          height={260}
          labels={days.map((d) => d.label)}
          series={[
            { key: "c", label: "Collected", cls: "s1", values: days.map((d) => d.collected) },
            { key: "p", label: "Paid out", cls: "s2", values: days.map((d) => d.paidOut) },
          ]}
        />
      </section>

      <div className="grid-2">
        <section className="panel rise" style={{ ["--d" as string]: "160ms" }}>
          <div className="panel-head">
            <h3>Prompt success rate</h3>
            <span className="panel-sub">Paid ÷ settled prompts, per day</span>
          </div>
          <AreaChart
            key={`r${range}`}
            height={210}
            labels={days.map((d) => d.label)}
            fixedMax={100}
            yFormat={(n) => `${Math.round(n)}%`}
            valueFormat={(n) => `${n.toFixed(1)}%`}
            series={[{ key: "r", label: "Success rate", cls: "s1", values: days.map((d) => (d.settled ? (d.paid / d.settled) * 100 : 0)) }]}
          />
        </section>

        <section className="panel rise" style={{ ["--d" as string]: "200ms" }}>
          <div className="panel-head">
            <h3>Prompt outcomes</h3>
            <span className="panel-sub">{num(settled)} settled</span>
          </div>
          <div className="panel-body obars">
            {outs.map((o, i) => (
              <div key={o.key} className="obar">
                <div className="obar-top">
                  <span className={`st-ic ${o.tone}`}>
                    <Icon name={OUT_ICON[o.tone]} size={11} strokeWidth={2.2} />
                  </span>
                  {o.label}
                  <span className="code">{o.code}</span>
                  <b>{num(o.count)}</b>
                  <em>{settled ? `${((o.count / settled) * 100).toFixed(1)}%` : "—"}</em>
                </div>
                <div className="obar-track">
                  <div className={`obar-fill ${o.tone}`} style={{ width: `${settled ? (o.count / settled) * 100 : 0}%`, ["--d" as string]: `${300 + i * 80}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel rise" style={{ ["--d" as string]: "240ms" }}>
          <div className="panel-head">
            <h3>Busiest hours</h3>
            <span className="panel-sub">
              Peak {String(peak).padStart(2, "0")}:00 – {String((peak + 1) % 24).padStart(2, "0")}:00
            </span>
          </div>
          <BarChart
            key={`h${range}`}
            labels={hours.map((h) => `${String(h.h).padStart(2, "0")}h`)}
            values={hours.map((h) => h.count)}
            format={(n) => `${n} paid`}
            highlight={peak}
          />
        </section>

        <section className="panel rise" style={{ ["--d" as string]: "280ms" }}>
          <div className="panel-head">
            <h3>Ticket size</h3>
            <span className="panel-sub">Successful payments, KES</span>
          </div>
          <div className="panel-body obars">
            {bands.map((b, i) => (
              <div key={b.label} className="obar">
                <div className="obar-top">
                  {b.label}
                  <b>{num(b.count)}</b>
                </div>
                <div className="obar-track">
                  <div className="obar-fill ok" style={{ width: `${(b.count / maxBand) * 100}%`, ["--d" as string]: `${300 + i * 70}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel rise" style={{ ["--d" as string]: "320ms" }}>
        <div className="panel-head">
          <h3>Payouts</h3>
          <span className="panel-sub">Last {range} days</span>
        </div>
        <div className="grid-3" style={{ padding: 18, gap: 24 }}>
          <dl className="mini-stats" style={{ gridTemplateColumns: "1fr 1fr", boxShadow: "none" }}>
            <div>
              <dt>Sent</dt>
              <dd>{num(poRange.length - poFailed)}</dd>
            </div>
            <div>
              <dt>Failed · refunded</dt>
              <dd>{num(poFailed)}</dd>
            </div>
            <div style={{ borderLeft: 0, borderTop: "1px solid var(--line)" }}>
              <dt>Total</dt>
              <dd>{kes(cur.paidOut)}</dd>
            </div>
            <div style={{ borderTop: "1px solid var(--line)" }}>
              <dt>Failure rate</dt>
              <dd>{poRange.length ? `${((poFailed / poRange.length) * 100).toFixed(1)}%` : "—"}</dd>
            </div>
          </dl>
          <div className="obars" style={{ gridColumn: "span 2" }}>
            {reasons.length === 0 && <p className="muted">No payouts in this range.</p>}
            {reasons.map((x, i) => (
              <div key={x.r} className="obar">
                <div className="obar-top">
                  <span style={{ textTransform: "capitalize" }}>{x.r}</span>
                  <b>{money(x.amount)}</b>
                </div>
                <div className="obar-track">
                  <div className="obar-fill" style={{ width: `${(x.amount / maxReason) * 100}%`, background: "var(--series-2)", ["--d" as string]: `${360 + i * 70}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
