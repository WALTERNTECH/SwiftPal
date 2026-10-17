"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { PageHeader } from "@/components/dash/ui";
import { FeeCalculator } from "@/components/site/FeeCalculator";
import { fee, money2, num } from "@/lib/format";
import { b2cFee, B2C_BANDS, STK_BANDS } from "@/lib/pricing";
import { useApi, useMode, type Analytics } from "@/lib/api";

export default function DashPricing() {
  const mode = useMode();
  const { open } = useActions();
  const [probe, setProbe] = useState("3500");
  const probeAmt = Number(probe) || 0;
  const activeBand = B2C_BANDS.findIndex((b) => probeAmt >= b.min && (b.max === null || probeAmt <= b.max));

  const { data: a30 } = useApi<Analytics>(`/app/analytics?mode=${mode}&days=30`);
  const cur = a30?.current;
  const month = { total: cur?.fees ?? 0, count: (cur?.successful ?? 0) + (cur?.payouts ?? 0), vol: (cur?.collected ?? 0) + (cur?.paid_out ?? 0) };

  return (
    <>
      <PageHeader
        title="Pricing"
        sub="Rates on your account. Fees come from fee credit."
        actions={
          <button className="btn btn-pine" onClick={() => open("topup-fee")}>
            <Icon name="plus" size={14} /> Top up fee credit
          </button>
        }
      />

      <div className="grid-3">
        <section className="stat rise" style={{ padding: 20 }}>
          <div className="stat-label">
            <span className="stat-ic"><Icon name="collect" size={13} /></span> STK Push
          </div>
          <div className="stat-val" style={{ fontSize: 34 }}>KES {STK_BANDS[1].flat!.toFixed(2)}</div>
          <span className="muted" style={{ fontSize: 12.5 }}>per successful payment · free under KES 10</span>
        </section>
        <section className="stat rise" style={{ padding: 20, ["--d" as string]: "60ms" }}>
          <div className="stat-label">
            <span className="stat-ic blue"><Icon name="payout" size={13} /></span> B2C payout
          </div>
          <div className="stat-val" style={{ fontSize: 34 }}>
            <span className="muted" style={{ fontSize: 14, marginRight: 6 }}>from</span>KES {B2C_BANDS[0].flat}
          </div>
          <span className="muted" style={{ fontSize: 12.5 }}>per recipient · refunded if it fails</span>
        </section>
        <section className="stat rise" style={{ padding: 20, ["--d" as string]: "120ms" }}>
          <div className="stat-label">
            <span className="stat-ic"><Icon name="receipt" size={13} /></span> Fees · 30 days
          </div>
          <div className="stat-val" style={{ fontSize: 34 }}>{money2(month.total)}</div>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {num(month.count)} transactions · {month.vol ? `${((month.total / month.vol) * 100).toFixed(2)}% of volume` : "no volume yet"}
          </span>
        </section>
      </div>

      <div className="rise" style={{ ["--d" as string]: "160ms" }}>
        <FeeCalculator />
      </div>

      <div className="grid-2 rates">
        <section className="panel rise" style={{ ["--d" as string]: "200ms" }}>
          <div className="panel-head"><h3>STK Push</h3><span className="panel-sub">Charged on success</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Amount (KES)</th><th className="right">Fee</th></tr></thead>
              <tbody>
                {STK_BANDS.map((b) => (
                  <tr key={b.min}>
                    <td className="num">{num(b.min)} – {b.max === null ? "250,000" : num(b.max)}</td>
                    <td className="right num">{fee(b.flat!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body" style={{ borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
            <div className="spread"><span className="muted" style={{ fontSize: 13 }}>Cancelled, expired or failed</span><b className="num">Free</b></div>
            <div className="spread"><span className="muted" style={{ fontSize: 13 }}>Top-ups</span><b className="num">Free</b></div>
          </div>
        </section>

        <section className="panel rise" style={{ ["--d" as string]: "240ms" }}>
          <div className="panel-head">
            <h3>B2C payouts</h3>
            <label className="row" style={{ gap: 8, fontSize: 12.5 }}>
              <span className="muted">Find band</span>
              <div className="input-group" style={{ width: 150 }}>
                <span className="prefix" style={{ height: 30, fontSize: 12 }}>KES</span>
                <input className="input mono" style={{ height: 30, fontSize: 12.5 }} inputMode="numeric" value={probe} onChange={(e) => setProbe(e.target.value.replace(/\D/g, ""))} aria-label="Amount" />
              </div>
              <b className="num" style={{ minWidth: 58, textAlign: "right" }}>{b2cFee(probeAmt) === null ? "—" : `KES ${b2cFee(probeAmt)}`}</b>
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th>Amount (KES)</th><th className="right">Fee per recipient</th></tr></thead>
              <tbody>
                {B2C_BANDS.map((b, i) => (
                  <tr key={b.min} style={i === activeBand ? { background: "var(--pine-wash)" } : undefined}>
                    <td className="num">
                      {num(b.min)} – {b.max === null ? "+" : num(b.max)}
                      {i === activeBand && <span className="badge pine plain" style={{ marginLeft: 10 }}>this amount</span>}
                    </td>
                    <td className="right num">{fee(b.flat!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
