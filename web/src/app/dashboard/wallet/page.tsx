"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { TopUpModal, WithdrawModal } from "@/components/dash/modals";
import { Empty, PageHeader, useToast } from "@/components/dash/ui";
import { dateTime, money2, num } from "@/lib/format";
import { setAutoCover, setLowBalanceAt, useStore, type LedgerEntry } from "@/lib/store";

const KIND: Record<LedgerEntry["kind"], string> = {
  top_up: "Top-up via M-Pesa",
  fee: "Fee",
  fee_release: "Fee refunded",
  payout: "Payout",
  payout_refund: "Payout returned",
  withdrawal: "Withdrawal to M-Pesa",
  starter_credit: "Starter credit",
};

export default function Wallet() {
  const s = useStore();
  const toast = useToast();
  const [topUp, setTopUp] = useState<"fee" | "float" | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [threshold, setThreshold] = useState(String(s.lowBalanceAt));
  const [which, setWhich] = useState<"all" | "fee" | "float">("all");
  const bal = s.balances[s.mode];

  const ledger = useMemo(
    () => s.ledger.filter((l) => l.mode === s.mode && (which === "all" || l.balance === which)),
    [s.ledger, s.mode, which],
  );

  const held = useMemo(() => {
    const pending = s.payments.filter((p) => p.mode === s.mode && p.status === "pending");
    return pending.reduce((a, p) => a + p.fee, 0);
  }, [s.payments, s.mode]);

  return (
    <>
      <PageHeader title="Wallet" sub="Two prefunded balances. Every deduction links back to the transaction that caused it." />

      <section className="balances">
        <div className="panel balance">
          <div className="spread">
            <b>Fee credit</b>
            <span className="badge plain">Non-withdrawable</span>
          </div>
          <div className="balance-amt"><small>KES</small>{bal.fee.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="balance-meta">
            <span>Held for pending <b>{money2(held)}</b></span>
            <span>≈ <b>{num(Math.floor(bal.fee / 2.5))}</b> paid prompts left</span>
          </div>
          <div className="row">
            <button className="btn btn-ink btn-sm" onClick={() => setTopUp("fee")}><Icon name="plus" size={14} /> Top up</button>
          </div>
        </div>
        <div className="panel balance">
          <div className="spread">
            <b>Payout float</b>
            <span className="badge pine">Withdrawable</span>
          </div>
          <div className="balance-amt"><small>KES</small>{bal.float.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="balance-meta">
            <span>Funds B2C payouts. Failed payouts come back here automatically.</span>
          </div>
          <div className="row">
            <button className="btn btn-ink btn-sm" onClick={() => setTopUp("float")}><Icon name="plus" size={14} /> Top up</button>
            <button className="btn btn-line btn-sm" onClick={() => setWithdraw(true)} disabled={bal.float < 10}>Withdraw</button>
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="panel panel-body spread" style={{ alignItems: "flex-start" }}>
          <div>
            <b>Auto-cover fees from payout float</b>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
              When fee credit can&apos;t cover a fee, take it from payout float instead of returning <code className="inline-code">402</code>.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={s.autoCover}
            aria-label="Auto-cover fees"
            className="switch"
            onClick={() => {
              setAutoCover(!s.autoCover);
              toast(`Auto-cover ${s.autoCover ? "off" : "on"}`);
            }}
          />
        </section>
        <section className="panel panel-body">
          <b>Low balance alert</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Email and SMS when fee credit drops below this amount.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="input-group" style={{ maxWidth: 200 }}>
              <span className="prefix">KES</span>
              <input className="input mono" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} aria-label="Alert threshold" />
            </div>
            <button
              className="btn btn-line"
              disabled={Number(threshold) === s.lowBalanceAt}
              onClick={() => {
                setLowBalanceAt(Number(threshold) || 0);
                toast("Alert threshold saved");
              }}
            >
              Save
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Ledger</h3>
          <div className="segmented" role="group" aria-label="Balance">
            <button aria-pressed={which === "all"} onClick={() => setWhich("all")}>All</button>
            <button aria-pressed={which === "fee"} onClick={() => setWhich("fee")}>Fee credit</button>
            <button aria-pressed={which === "float"} onClick={() => setWhich("float")}>Float</button>
          </div>
        </div>
        {ledger.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Entry</th><th>Balance</th><th>Linked to</th><th className="right">Amount</th><th>Date</th></tr>
              </thead>
              <tbody>
                {ledger.slice(0, 60).map((l) => (
                  <tr key={l.id}>
                    <td>{KIND[l.kind]}</td>
                    <td className="muted">{l.balance === "fee" ? "Fee credit" : "Payout float"}</td>
                    <td className="mono">{l.ref ?? <span className="dim">—</span>}</td>
                    <td className="right num" style={{ color: l.amount >= 0 ? "var(--ok)" : "var(--ink)" }}>
                      {l.amount >= 0 ? "+" : "−"}
                      {money2(Math.abs(l.amount)).replace("KES ", "")}
                    </td>
                    <td className="muted">{dateTime(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="receipt" title="No entries yet" body="Top-ups, fees, payouts and refunds will be listed here, each linked to its transaction." />
        )}
      </section>

      <TopUpModal open={topUp !== null} initial={topUp ?? "fee"} onClose={() => setTopUp(null)} />
      <WithdrawModal open={withdraw} onClose={() => setWithdraw(false)} />
    </>
  );
}
