"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { AreaChart, BarChart, CountUp, Delta, kes } from "@/components/dash/charts";
import { downloadCsv, PageHeader } from "@/components/dash/ui";
import { useApi, useMode, type Analytics as Data } from "@/lib/api";
import { dayLabel, delta, money, num } from "@/lib/format";

type Range = 7 | 14 | 30;
const TONE: Record<string, "ok" | "warn" | "bad" | ""> = { succeeded: "ok", cancelled: "warn", expired: "", failed: "bad" };
const OUT_ICON: Record<string, IconName> = { ok: "check", warn: "x", bad: "alert", "": "clock" };

export default function Analytics() {
  const mode = useMode();
  const [range, setRange] = useState<Range>(30);
  const { data: a, error } = useApi<Data>(`/app/analytics?mode=${mode}&days=${range}`);

  const header = (
    <PageHeader
      title="Analytics"
      sub={`Last ${range} days vs the ${range} before`}
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
            disabled={!a}
            onClick={() =>
              a &&
              downloadCsv(`swiftpal-daily-${mode}-${range}d.csv`, [
                ["date", "prompts", "paid", "collected_kes", "paid_out_kes", "success_rate"],
                ...a.series.map((d) => [d.date, d.prompts, d.successful, d.collected, d.paid_out, d.settled ? (d.successful / d.settled).toFixed(3) : ""]),
              ])
            }
          >
            <Icon name="download" size={14} /> Export
          </button>
        </>
      }
    />
  );

  if (!a) {
    return (
      <>
        {header}
        <section className="panel">
          <div className="empty">{error ? <p className="muted">{error.message}</p> : <span className="spinner" />}</div>
        </section>
      </>
    );
  }

  const cur = a.current;
  const prev = a.previous;
  const labels = a.series.map((d) => dayLabel(d.date));
  const settled = a.outcomes.reduce((s, o) => s + o.count, 0);
  const peak = a.hours.reduce((m, h) => (h.successful > a.hours[m].successful ? h.hour : m), 0);
  const maxBand = Math.max(...a.ticket_bands.map((b) => b.count), 1);
  const maxReason = Math.max(...a.payout_reasons.map((x) => x.amount), 1);
  const poTotal = cur.payouts + cur.payouts_failed;

  const kpis = [
    { l: "Collected", v: cur.collected, f: kes, d: delta(cur.collected, prev.collected) },
    { l: "Successful payments", v: cur.successful, f: (n: number) => num(Math.round(n)), d: delta(cur.successful, prev.successful) },
    { l: "Success rate", v: (cur.success_rate ?? 0) * 100, f: (n: number) => `${n.toFixed(1)}%`, d: delta(cur.success_rate, prev.success_rate) },
    { l: "Average ticket", v: cur.average_ticket ?? 0, f: kes, d: delta(cur.average_ticket, prev.average_ticket) },
    { l: "Paid out", v: cur.paid_out, f: kes, d: delta(cur.paid_out, prev.paid_out) },
    { l: "Fees", v: cur.fees, f: (n: number) => `KES ${n.toFixed(2)}`, d: delta(cur.fees, prev.fees), invert: true },
  ];

  return (
    <>
      {header}

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
              <span><i className="swatch s2" /> Paid out <b>{money(cur.paid_out)}</b></span>
            </div>
          </div>
        </div>
        <AreaChart
          key={`v${range}`}
          height={260}
          labels={labels}
          series={[
            { key: "c", label: "Collected", cls: "s1", values: a.series.map((d) => d.collected) },
            { key: "p", label: "Paid out", cls: "s2", values: a.series.map((d) => d.paid_out) },
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
            labels={labels}
            fixedMax={100}
            yFormat={(n) => `${Math.round(n)}%`}
            valueFormat={(n) => `${n.toFixed(1)}%`}
            series={[{ key: "r", label: "Success rate", cls: "s1", values: a.series.map((d) => (d.settled ? (d.successful / d.settled) * 100 : 0)) }]}
          />
        </section>

        <section className="panel rise" style={{ ["--d" as string]: "200ms" }}>
          <div className="panel-head">
            <h3>Prompt outcomes</h3>
            <span className="panel-sub">{num(settled)} settled</span>
          </div>
          <div className="panel-body obars">
            {a.outcomes.map((o, i) => {
              const tone = TONE[o.key] ?? "";
              return (
                <div key={o.key} className="obar">
                  <div className="obar-top">
                    <span className={`st-ic ${tone}`}>
                      <Icon name={OUT_ICON[tone]} size={11} strokeWidth={2.2} />
                    </span>
                    {o.label}
                    <span className="code">{o.code}</span>
                    <b>{num(o.count)}</b>
                    <em>{settled ? `${((o.count / settled) * 100).toFixed(1)}%` : "—"}</em>
                  </div>
                  <div className="obar-track">
                    <div className={`obar-fill ${tone}`} style={{ width: `${settled ? (o.count / settled) * 100 : 0}%`, ["--d" as string]: `${300 + i * 80}ms` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel rise" style={{ ["--d" as string]: "240ms" }}>
          <div className="panel-head">
            <h3>Busiest hours</h3>
            <span className="panel-sub">
              Peak {String(peak).padStart(2, "0")}:00 – {String((peak + 1) % 24).padStart(2, "0")}:00 EAT
            </span>
          </div>
          <BarChart
            key={`h${range}`}
            labels={a.hours.map((h) => `${String(h.hour).padStart(2, "0")}h`)}
            values={a.hours.map((h) => h.successful)}
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
            {a.ticket_bands.map((b, i) => (
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
              <dd>{num(cur.payouts)}</dd>
            </div>
            <div>
              <dt>Failed · refunded</dt>
              <dd>{num(cur.payouts_failed)}</dd>
            </div>
            <div style={{ borderLeft: 0, borderTop: "1px solid var(--line)" }}>
              <dt>Total</dt>
              <dd>{kes(cur.paid_out)}</dd>
            </div>
            <div style={{ borderTop: "1px solid var(--line)" }}>
              <dt>Failure rate</dt>
              <dd>{poTotal ? `${((cur.payouts_failed / poTotal) * 100).toFixed(1)}%` : "—"}</dd>
            </div>
          </dl>
          <div className="obars" style={{ gridColumn: "span 2" }}>
            {a.payout_reasons.length === 0 && <p className="muted">No payouts in this range.</p>}
            {a.payout_reasons.map((x, i) => (
              <div key={x.reason} className="obar">
                <div className="obar-top">
                  <span style={{ textTransform: "capitalize" }}>{x.reason}</span>
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
