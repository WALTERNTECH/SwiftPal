"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, useToast } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dayLabel, money, money2 } from "@/lib/format";

type Report = {
  from: string;
  to: string;
  totals: { collected: number; payments: number; prompts: number; paid_out: number; payouts: number; fees: number; signups: number };
  series: { date: string; collected: number; payments: number; prompts: number; paid_out: number; payouts: number; fees: number; signups: number }[];
  top_merchants: { id: string; name: string; account_code: string; collected: number; payments: number; paid_out: number; fees: number }[];
};

const day = (offset = 0) => new Date(Date.now() + 3 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);
const PRESETS = [
  { t: "7 days", from: () => day(6) },
  { t: "30 days", from: () => day(29) },
  { t: "90 days", from: () => day(89) },
  { t: "This year", from: () => `${day().slice(0, 4)}-01-01` },
];

export default function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(day(29));
  const [to, setTo] = useState(day());
  const { data: r } = useApi<Report>(`/reports?from=${from}&to=${to}`);
  const max = Math.max(1, ...(r?.series.map((s) => s.collected) ?? [1]));

  async function csv() {
    try {
      const res = await fetch(`/backend/admin/reports/revenue.csv?from=${from}&to=${to}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `swiftpal-revenue-${from}-to-${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast((e as Error).message, "alert");
    }
  }

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Live mode, Nairobi days"
        actions={
          <button className="btn btn-line" onClick={csv}>
            <Icon name="download" size={15} /> Revenue CSV
          </button>
        }
      />

      <section className="panel">
        <div className="toolbar">
          <div className="seg-tabs" role="group">
            {PRESETS.map((p) => (
              <button key={p.t} aria-current={from === p.from() && to === day()} onClick={() => { setFrom(p.from()); setTo(day()); }}>
                {p.t}
              </button>
            ))}
          </div>
          <input type="date" className="input" style={{ width: 160 }} value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="input" style={{ width: 160 }} value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
        {r ? (
          <>
            <div className="bars" aria-label="Collected per day">
              {r.series.map((s) => (
                <span key={s.date} title={`${dayLabel(s.date)}: ${money(s.collected)} · ${s.payments} payments · fees ${money2(s.fees)}`} style={{ height: `${Math.max(2, (s.collected / max) * 100)}%` }} />
              ))}
            </div>
            <div className="bars-axis">
              <span>{dayLabel(r.from)}</span>
              <span>Collected per day</span>
              <span>{dayLabel(r.to)}</span>
            </div>
          </>
        ) : (
          <div className="empty"><span className="spinner" /></div>
        )}
      </section>

      {r && (
        <>
          <div className="cards">
            <div className="card-stat"><span>Collected</span><b>{money(r.totals.collected)}</b><em>{r.totals.payments} payments of {r.totals.prompts} prompts</em></div>
            <div className="card-stat"><span>Paid out</span><b>{money(r.totals.paid_out)}</b><em>{r.totals.payouts} payouts</em></div>
            <div className="card-stat"><span>Fees earned</span><b>{money2(r.totals.fees)}</b><em>{r.totals.prompts ? `${((r.totals.payments / r.totals.prompts) * 100).toFixed(1)}% prompt success` : "No prompts"}</em></div>
            <div className="card-stat"><span>New merchants</span><b>{r.totals.signups}</b><em>{dayLabel(r.from)} to {dayLabel(r.to)}</em></div>
          </div>

          <section className="panel">
            <div className="panel-head"><h3>Top merchants by fees</h3></div>
            {r.top_merchants.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Merchant</th><th className="right">Collected</th><th className="right">Payments</th><th className="right">Paid out</th><th className="right">Fees</th></tr></thead>
                  <tbody>
                    {r.top_merchants.map((m) => (
                      <tr key={m.id}>
                        <td><Link href={`/merchants/${m.id}`}>{m.name}</Link> <span className="dim mono">· {m.account_code}</span></td>
                        <td className="right num">{money(m.collected)}</td>
                        <td className="right num">{m.payments}</td>
                        <td className="right num">{money(m.paid_out)}</td>
                        <td className="right num">{money2(m.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-body muted">No live activity in this range.</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h3>By day</h3></div>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="table">
                <thead><tr><th>Day</th><th className="right">Collected</th><th className="right">Payments</th><th className="right">Paid out</th><th className="right">Fees</th><th className="right">Sign-ups</th></tr></thead>
                <tbody>
                  {[...r.series].reverse().map((s) => (
                    <tr key={s.date}>
                      <td className="muted">{dayLabel(s.date)}</td>
                      <td className="right num">{money(s.collected)}</td>
                      <td className="right num">{s.payments}</td>
                      <td className="right num">{money(s.paid_out)}</td>
                      <td className="right num">{money2(s.fees)}</td>
                      <td className="right num">{s.signups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
