"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { dateTime, fee, maskPhone, money, money2, normalisePhone } from "@/lib/format";
import { b2cFee, stkFee } from "@/lib/pricing";
import { SANDBOX_NUMBERS } from "@/lib/site";
import { simulatePayout, simulateStk, topUp, useStore, withdrawFloat, type Payment } from "@/lib/store";
import { Drawer, KV, Modal, PayBadge, useToast } from "./ui";

// ---------- new STK payment ----------
export function NewPaymentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const s = useStore();
  const toast = useToast();
  const test = s.mode === "test";
  const [phone, setPhone] = useState(test ? "254700000000" : "");
  const [amount, setAmount] = useState("100");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPhone(test ? "254700000000" : s.account?.phone ?? "");
      setReference(`TEST-${Math.floor(Math.random() * 9000 + 1000)}`);
      setError("");
    }
  }, [open, test, s.account?.phone]);

  const amt = Math.floor(Number(amount) || 0);
  const f = stkFee(amt);

  function submit() {
    const p = normalisePhone(phone);
    if (!p) return setError("Enter a Safaricom number.");
    if (amt < 1 || amt > 250_000) return setError("Amount must be between KES 1 and KES 250,000.");
    if (!reference.trim() || reference.length > 12) return setError("Reference must be 1–12 characters.");
    const r = simulateStk({ phone: p, amount: amt, reference: reference.trim() });
    if (!r.ok) return setError(`${r.code}: ${r.message}`);
    toast(`Prompt sent to ${maskPhone(p)}`);
    onCreated?.(r.payment.id);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={test ? "Send a test STK Push" : "Send an STK Push"}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" onClick={submit}>Send prompt</button>
        </>
      }
    >
      {test && (
        <div className="field">
          <span className="label">Sandbox outcome</span>
          <div className="amount-chips">
            {SANDBOX_NUMBERS.map((n) => (
              <button key={n.phone} type="button" onClick={() => setPhone(n.phone)} aria-pressed={phone === n.phone} style={phone === n.phone ? { borderColor: "var(--ink)" } : undefined}>
                {n.outcome}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="np-phone">Customer phone</label>
        <input id="np-phone" className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="np-amt">Amount</label>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input id="np-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="np-ref">Reference</label>
          <input id="np-ref" className="input mono" maxLength={12} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <p className="hint">
        Fee if the customer pays: <b className="num">{f === null ? "—" : fee(f)}</b>. Nothing is charged if they cancel or it times out.
      </p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

// ---------- payment detail ----------
export function PaymentDrawer({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  if (!payment) return null;
  const p = payment;
  const t0 = new Date(p.createdAt).getTime();
  const at = (s: number) => new Date(t0 + s * 1000).toLocaleTimeString("en-KE", { hour12: false });
  const done = p.status !== "pending";
  const json = JSON.stringify(
    {
      id: p.id,
      object: "payment",
      status: p.status,
      amount: p.amount,
      currency: "KES",
      phone: p.phone,
      reference: p.reference,
      channel: p.channel,
      mpesa_receipt: p.receipt,
      failure_code: p.failureCode,
      fee: { amount: p.fee, charged: p.feeCharged },
      livemode: p.mode === "live",
      created_at: p.createdAt,
    },
    null,
    2,
  );
  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="row">
          <b className="num" style={{ fontSize: 18 }}>{money(p.amount)}</b>
          <PayBadge s={p.status} />
        </div>
      }
    >
      <KV
        rows={[
          ["Payment ID", <span key="id" className="mono">{p.id}</span>],
          ["Customer", <span key="ph" className="mono">{p.phone}</span>],
          ["Reference", <span key="r" className="mono">{p.reference}</span>],
          ["M-Pesa receipt", p.receipt ? <span key="rc" className="mono">{p.receipt}</span> : <span key="rc" className="dim">—</span>],
          ["Channel", <span key="c" className="mono">{p.channel}</span>],
          ["Fee", p.feeCharged ? money2(p.fee) : <span key="f" className="muted">{p.fee === 0 ? "Free" : `${money2(p.fee)} not charged`}</span>],
          ["Created", dateTime(p.createdAt)],
        ]}
      />
      <div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Timeline</div>
        <ol className="timeline">
          <li><span className="pt ok" /><span>Request received · <span className="mono">POST /v1/stk-push</span></span><time>{at(0)}</time></li>
          <li><span className="pt ok" /><span>Prompt delivered to {maskPhone(p.phone)}</span><time>{at(2)}</time></li>
          {!done && <li><span className="pt" /><span>Waiting for customer…</span><time /></li>}
          {p.status === "succeeded" && <li><span className="pt ok" /><span>Paid · receipt <span className="mono">{p.receipt}</span></span><time>{at(12)}</time></li>}
          {p.status === "cancelled" && <li><span className="pt warn" /><span>Customer cancelled (1032) · fee released</span><time>{at(9)}</time></li>}
          {p.status === "expired" && <li><span className="pt" /><span>No response in 60s (1037) · fee released</span><time>{at(62)}</time></li>}
          {p.status === "failed" && <li><span className="pt bad" /><span>Declined: insufficient funds (1) · fee released</span><time>{at(11)}</time></li>}
          {done && <li><span className="pt ok" /><span>Webhook <span className="mono">payment.{p.status}</span> delivered · 200</span><time>{at(p.status === "expired" ? 63 : 13)}</time></li>}
        </ol>
      </div>
      <CodeBlock tabs={[{ label: "GET /v1/stk-push/" + p.id.slice(0, 10) + "…", lang: "json", code: json }]} />
    </Drawer>
  );
}

// ---------- top up ----------
export function TopUpModal({ open, onClose, initial = "fee" }: { open: boolean; onClose: () => void; initial?: "fee" | "float" }) {
  const s = useStore();
  const toast = useToast();
  const [balance, setBalance] = useState<"fee" | "float">(initial);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"form" | "waiting">("form");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setBalance(initial);
      setAmount(initial === "fee" ? "500" : "10000");
      setPhone(s.account?.phone ?? "");
      setStage("form");
      setError("");
    }
  }, [open, initial, s.account?.phone]);

  const amt = Math.floor(Number(amount) || 0);

  function submit() {
    if (amt < 10) return setError("Top up at least KES 10.");
    if (!normalisePhone(phone)) return setError("Enter the M-Pesa number to charge.");
    setError("");
    setStage("waiting");
    setTimeout(() => {
      topUp(s.mode, balance, amt);
      toast(`${money(amt)} added to ${balance === "fee" ? "fee credit" : "payout float"}`);
      onClose();
    }, 2600);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Top up"
      footer={
        stage === "form" ? (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-ink" onClick={submit}>Send M-Pesa prompt</button>
          </>
        ) : undefined
      }
    >
      {stage === "form" ? (
        <>
          <div className="segmented" role="group" aria-label="Balance">
            <button aria-pressed={balance === "fee"} onClick={() => setBalance("fee")}>Fee credit</button>
            <button aria-pressed={balance === "float"} onClick={() => setBalance("float")}>Payout float</button>
          </div>
          <p className="hint" style={{ marginTop: -6 }}>
            {balance === "fee" ? "Pays SwiftPal fees on STK Push and B2C. Not withdrawable." : "Funds B2C payouts. Withdrawable any time."}
          </p>
          <div className="field">
            <label className="label" htmlFor="tu-amt">Amount</label>
            <div className="input-group">
              <span className="prefix">KES</span>
              <input id="tu-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="amount-chips">
              {(balance === "fee" ? [250, 500, 1000, 5000] : [5000, 10000, 50000, 100000]).map((a) => (
                <button key={a} type="button" onClick={() => setAmount(String(a))}>{a.toLocaleString()}</button>
              ))}
            </div>
            {balance === "fee" && amt >= 10 && <span className="hint">Covers about {Math.floor(amt / 2.5).toLocaleString()} successful STK Push payments.</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="tu-ph">Pay from M-Pesa number</label>
            <input id="tu-ph" className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      ) : (
        <div className="empty" style={{ padding: "24px 8px" }}>
          <div className="empty-icon"><span className="spinner" /></div>
          <b>Check your phone</b>
          <p className="muted">
            Enter your M-Pesa PIN to pay <b className="num">{money(amt)}</b> to SwiftPal. Your balance updates as soon as M-Pesa confirms.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ---------- withdraw ----------
export function WithdrawModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const bal = s.balances[s.mode];
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setAmount("");
      setError("");
    }
  }, [open]);
  const amt = Math.floor(Number(amount) || 0);
  const f = b2cFee(amt);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withdraw payout float"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-ink"
            onClick={() => {
              if (f === null) return setError("Withdraw between KES 10 and KES 250,000.");
              if (amt > bal.float) return setError(`You have ${money(bal.float)} available.`);
              if (f > bal.fee) return setError(`This needs ${money(f)} fee credit.`);
              withdrawFloat(s.mode, amt);
              toast(`${money(amt)} on its way to ${maskPhone(s.account?.phone ?? "")}`);
              onClose();
            }}
          >
            Withdraw
          </button>
        </>
      }
    >
      <div className="field">
        <div className="label-row">
          <label className="label" htmlFor="wd-amt">Amount</label>
          <button className="link" style={{ border: 0, background: "none", fontSize: 13, cursor: "pointer" }} onClick={() => setAmount(String(Math.min(bal.float, 250_000)))}>
            Max {money(Math.min(bal.float, 250_000))}
          </button>
        </div>
        <div className="input-group">
          <span className="prefix">KES</span>
          <input id="wd-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      <KV
        rows={[
          ["Sent to", <span key="p" className="mono">{s.account?.phone}</span>],
          ["Fee", f === null ? "—" : <span key="f" className="num">{money(f)} from fee credit</span>],
        ]}
      />
      <p className="hint">Withdrawals go to the M-Pesa number on your account. To change it, update your profile in Settings.</p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

// ---------- single payout ----------
export function PayoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("withdrawal");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setPhone(s.mode === "test" ? "254712345678" : "");
      setAmount("1500");
      setReference(`WD-${Math.floor(Math.random() * 90000 + 10000)}`);
      setError("");
    }
  }, [open, s.mode]);
  const amt = Math.floor(Number(amount) || 0);
  const f = b2cFee(amt);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a payout"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-ink"
            onClick={() => {
              const p = normalisePhone(phone);
              if (!p) return setError("Enter a Safaricom number.");
              const r = simulatePayout({ phone: p, amount: amt, reference: reference.trim() || "PAYOUT", reason });
              if (!r.ok) return setError(`${r.code}: ${r.message}`);
              toast(`${money(amt)} payout to ${maskPhone(p)} is processing`);
              onClose();
            }}
          >
            Send {amt ? money(amt) : "payout"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="po-ph">Recipient phone</label>
        <input id="po-ph" className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="po-amt">Amount</label>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input id="po-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="po-reason">Reason</label>
          <select id="po-reason" className="select input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {["withdrawal", "salary", "refund", "commission", "promotion", "other"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="po-ref">Reference</label>
        <input id="po-ref" className="input mono" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <div className="callout">
        <Icon name="info" size={16} />
        <span>
          Fee <b className="num">{f === null ? "—" : money(f)}</b> from fee credit. If M-Pesa rejects the payout, both the amount and the fee are returned.
        </span>
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
