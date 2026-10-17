"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useActions } from "@/components/dash/actions";
import { CountUp } from "@/components/dash/charts";
import { Empty, PageHeader, useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, useApi, useMode, type ApiError, type LedgerRow } from "@/lib/api";
import { dateTime, money2 } from "@/lib/format";

const KIND: Record<string, string> = {
  top_up: "Top-up via M-Pesa",
  fee: "Fee",
  payout: "Payout",
  withdrawal: "Withdrawal to M-Pesa",
  starter_credit: "Starter credit",
};

const fmt2 = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Wallet() {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const { open } = useActions();
  const [which, setWhich] = useState<"all" | "fee" | "float">("all");
  const [threshold, setThreshold] = useState(String(me.merchant.low_balance_at));
  const [saving, setSaving] = useState(false);
  const { data: ledger, loading } = useApi<LedgerRow[]>(`/app/ledger?mode=${mode}${which === "all" ? "" : `&account=${which}`}`);
  const bal = me.balances[mode];
  const autoCover = me.merchant.auto_cover;

  useEffect(() => setThreshold(String(me.merchant.low_balance_at)), [me.merchant.low_balance_at]);

  async function saveMerchant(body: Record<string, unknown>, done: string) {
    setSaving(true);
    try {
      await api("/app/merchant", { method: "PATCH", body });
      invalidate("/app/me", "/app/wallet");
      toast(done);
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
    setSaving(false);
  }

  return (
    <>
      <PageHeader title="Wallet" sub="Fee credit and payout float" />

      <section className="bal-hero rise">
        <div className="bal-orb" />
        <div className="bal-top">
          <span className="eyebrow">Balances · {mode}</span>
          <span className="bal-chip"><i /> Updated live</span>
        </div>
        <div className="bal-grid">
          <div className="bal-item">
            <span>Fee credit</span>
            <div className="bal-amt"><small>KES</small><CountUp value={bal.fee_credit.available} format={fmt2} /></div>
            <div className="bal-meta">held for pending {money2(bal.fee_credit.held)} · ≈ {Math.floor(bal.fee_credit.available / 2.5).toLocaleString()} paid prompts</div>
            <div className="bal-actions" style={{ marginTop: 14 }}>
              <button className="bal-btn primary" onClick={() => open("topup-fee")}><Icon name="plus" size={14} /> Top up</button>
            </div>
          </div>
          <div className="bal-item">
            <span>Payout float</span>
            <div className="bal-amt"><small>KES</small><CountUp value={bal.payout_float.available} format={fmt2} /></div>
            <div className="bal-meta">
              withdrawable{bal.payout_float.held > 0 ? ` · ${money2(bal.payout_float.held)} in flight` : ""} · failed payouts return here
            </div>
            <div className="bal-actions" style={{ marginTop: 14 }}>
              <button className="bal-btn primary" onClick={() => open("topup-float")}><Icon name="plus" size={14} /> Fund float</button>
              <button className="bal-btn" onClick={() => open("withdraw")} disabled={bal.payout_float.available < 10}>Withdraw</button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid-2 grid-even">
        <section className="panel panel-body spread rise" style={{ alignItems: "flex-start", ["--d" as string]: "60ms" }}>
          <div>
            <b>Auto-cover fees</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Take fees from payout float when fee credit runs out.</p>
          </div>
          <button
            role="switch"
            aria-checked={autoCover}
            aria-label="Auto-cover fees"
            className="switch"
            disabled={saving}
            onClick={() => saveMerchant({ auto_cover: !autoCover }, `Auto-cover ${autoCover ? "off" : "on"}`)}
          />
        </section>
        <section className="panel panel-body rise" style={{ ["--d" as string]: "100ms" }}>
          <b>Low balance alert</b>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>An email and a webhook event when fee credit drops below this.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="input-group" style={{ maxWidth: 200 }}>
              <span className="prefix">KES</span>
              <input className="input mono" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} aria-label="Alert threshold" />
            </div>
            <button
              className="btn btn-line"
              disabled={saving || Number(threshold) === me.merchant.low_balance_at}
              onClick={() => saveMerchant({ low_balance_at: Number(threshold) || 0 }, "Alert saved")}
            >
              Save
            </button>
          </div>
        </section>
      </div>

      <section className="panel rise" style={{ ["--d" as string]: "140ms" }}>
        <div className="panel-head">
          <h3>Ledger</h3>
          <div className="pill-filter" role="group" aria-label="Balance">
            <button aria-pressed={which === "all"} onClick={() => setWhich("all")}>All</button>
            <button aria-pressed={which === "fee"} onClick={() => setWhich("fee")}>Fee credit</button>
            <button aria-pressed={which === "float"} onClick={() => setWhich("float")}>Float</button>
          </div>
        </div>
        {ledger?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Entry</th><th>Balance</th><th>Linked to</th><th className="right">Amount</th><th>Date</th></tr>
              </thead>
              <tbody>
                {ledger.slice(0, 100).map((l, i) => (
                  <tr key={l.id} style={{ animationDelay: `${Math.min(i, 30) * 15}ms` }}>
                    <td>
                      <span className={`ledger-ic ${l.amount >= 0 ? "in" : "out"}`}>
                        <Icon name={l.amount >= 0 ? "arrowLeft" : "arrowRight"} size={13} />
                      </span>
                      {KIND[l.kind] ?? l.kind}
                    </td>
                    <td className="muted">{l.account === "fee" ? "Fee credit" : "Payout float"}</td>
                    <td className="mono">{l.ref ?? <span className="dim">—</span>}</td>
                    <td className="right num" style={{ color: l.amount >= 0 ? "var(--ok)" : "var(--ink)", fontWeight: 500 }}>
                      {l.amount >= 0 ? "+" : "−"}
                      {fmt2(Math.abs(l.amount))}
                    </td>
                    <td className="muted">{dateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <Empty icon="receipt" title="No entries yet" body="Top-ups, fees, payouts and withdrawals appear here." />
        )}
      </section>
    </>
  );
}
