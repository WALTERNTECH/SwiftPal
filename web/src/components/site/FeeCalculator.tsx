"use client";

import { useMemo, useState } from "react";
import { b2cFee, marketB2cFee, MARKET_STK_FEE, stkFee } from "@/lib/pricing";
import { money2, num } from "@/lib/format";

type Kind = "stk" | "b2c";

export function FeeCalculator() {
  const [kind, setKind] = useState<Kind>("stk");
  const [amount, setAmount] = useState("1500");
  const [count, setCount] = useState("1000");
  const [success, setSuccess] = useState("75");

  const r = useMemo(() => {
    const a = Number(amount.replace(/,/g, "")) || 0;
    const n = Math.max(0, Math.floor(Number(count.replace(/,/g, "")) || 0));
    const rate = Math.min(100, Math.max(0, Number(success) || 0)) / 100;
    if (kind === "stk") {
      const f = stkFee(a);
      if (f === null) return null;
      const paid = Math.round(n * rate);
      const ours = paid * f;
      const theirs = a >= 10 ? n * MARKET_STK_FEE : 0;
      return { per: f, volume: paid * a, ours, theirs, paid, n };
    }
    const f = b2cFee(a);
    const m = marketB2cFee(a);
    if (f === null || m === null) return null;
    return { per: f, volume: n * a, ours: n * f, theirs: n * m, paid: n, n };
  }, [kind, amount, count, success]);

  return (
    <div className="panel calc">
      <div className="calc-in">
        <div className="spread">
          <b>Estimate your monthly fees</b>
          <div className="segmented" role="group" aria-label="Product">
            <button aria-pressed={kind === "stk"} onClick={() => setKind("stk")}>
              STK Push
            </button>
            <button aria-pressed={kind === "b2c"} onClick={() => setKind("b2c")}>
              B2C
            </button>
          </div>
        </div>
        <label className="field">
          <span className="label">Typical amount</span>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </label>
        <label className="field">
          <span className="label">{kind === "stk" ? "Prompts sent per month" : "Payouts per month"}</span>
          <input className="input mono" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        {kind === "stk" && (
          <label className="field">
            <span className="label-row">
              <span className="label">Share of prompts customers complete</span>
              <span className="num muted">{success}%</span>
            </span>
            <input
              type="range"
              min={30}
              max={100}
              value={success}
              onChange={(e) => setSuccess(e.target.value)}
              style={{ accentColor: "var(--pine)" }}
            />
            <span className="hint">Most checkouts land between 60% and 85%. The rest are cancelled or time out.</span>
          </label>
        )}
      </div>
      <div className="calc-out">
        {r ? (
          <>
            <div className="calc-line">
              <span className="muted">Fee per {kind === "stk" ? "successful payment" : "payout"}</span>
              <span className="num">{money2(r.per)}</span>
            </div>
            <div className="calc-line">
              <span className="muted">{kind === "stk" ? "Payments completed" : "Payouts sent"}</span>
              <span className="num">{num(r.paid)}</span>
            </div>
            <div className="calc-line">
              <span className="muted">Volume moved</span>
              <span className="num">{money2(r.volume)}</span>
            </div>
            <div className="calc-line calc-total">
              <span>SwiftPal fees</span>
              <span className="num">{money2(r.ours)}</span>
            </div>
            <div className="calc-line">
              <span className="muted">At a typical aggregator</span>
              <span className="num muted">{money2(r.theirs)}</span>
            </div>
            <div className="calc-line">
              <span className="save">You keep</span>
              <span className="num save">{money2(Math.max(0, r.theirs - r.ours))}</span>
            </div>
          </>
        ) : (
          <p className="muted">
            {kind === "b2c" ? "B2C payouts run from KES 10 to KES 250,000." : "Enter an amount of at least KES 1."}
          </p>
        )}
      </div>
    </div>
  );
}
