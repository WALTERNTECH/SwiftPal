"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { api, can, invalidate, useAccount, useApi, useMode, usePaymentWatch, type ApiError, type Payment, type Payout } from "@/lib/api";
import { dateTime, fee, maskPhone, money, money2, normalisePhone, phoneHint } from "@/lib/format";
import { b2cFee, stkFee } from "@/lib/pricing";
import { ActionError, SmsConfirm, type Confirmation } from "./SmsConfirm";
import { Drawer, KV, Modal, PayBadge, PayoutBadge, useToast } from "./ui";

const REASONS = ["withdrawal", "salary", "refund", "commission", "promotion", "other"];

// ---------- new STK payment ----------
export function NewPaymentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("100");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPhone("");
      setReference(`INV-${Math.floor(Math.random() * 9000 + 1000)}`);
      setError("");
      setBusy(false);
    }
  }, [open]);

  const amt = Math.floor(Number(amount) || 0);
  const f = stkFee(amt);

  async function submit() {
    const p = normalisePhone(phone);
    if (!p) return setError("Enter a Safaricom number.");
    if (amt < 1 || amt > 250_000) return setError("Amount must be between KES 1 and KES 250,000.");
    if (!reference.trim() || reference.length > 12) return setError("Reference must be 1–12 characters.");
    setBusy(true);
    setError("");
    try {
      const pay = await api<Payment>("/app/payments", { body: { mode, phone: p, amount: amt, reference: reference.trim() } });
      invalidate("/app/payments", "/app/me");
      toast(`Prompt sent to ${maskPhone(p)}`);
      onCreated?.(pay.id);
      onClose();
    } catch (err) {
      const e = err as ApiError;
      setError(`${e.code}: ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a payment"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : "Send prompt"}
          </button>
        </>
      }
    >
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
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour12: false });

export function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const p = usePaymentWatch(id);
  if (!id) return null;
  if (!p) {
    return (
      <Drawer open onClose={onClose} title={<span className="mono">{id}</span>}>
        <span className="spinner" />
      </Drawer>
    );
  }
  const done = p.status !== "pending";
  const failure = p.failure_code ? `${p.failure_message ?? "Not completed"} (${p.failure_code})` : p.failure_message ?? "Not completed";
  const json = JSON.stringify({ ...p, object: "payment", currency: "KES" }, null, 2);
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
          ["M-Pesa receipt", p.mpesa_receipt ? <span key="rc" className="mono">{p.mpesa_receipt}</span> : <span key="rc" className="dim">—</span>],
          ["Channel", p.channel ? <span key="c" className="mono">{p.channel}</span> : <span key="c" className="dim">—</span>],
          ["Fee", p.fee.charged ? money2(p.fee.amount) : <span key="f" className="muted">{p.fee.amount === 0 ? "Free" : `${money2(p.fee.amount)} not charged`}</span>],
          ["Created", dateTime(p.created_at)],
        ]}
      />
      <div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Timeline</div>
        <ol className="timeline">
          <li><span className="pt ok" /><span>Prompt sent to {maskPhone(p.phone)}</span><time>{time(p.created_at)}</time></li>
          {!done && <li><span className="pt" /><span>Waiting for the customer…</span><time /></li>}
          {p.status === "succeeded" && <li><span className="pt ok" /><span>Paid · receipt <span className="mono">{p.mpesa_receipt}</span></span><time>{p.completed_at && time(p.completed_at)}</time></li>}
          {p.status === "cancelled" && <li><span className="pt warn" /><span>{failure} · fee released</span><time>{p.completed_at && time(p.completed_at)}</time></li>}
          {p.status === "expired" && <li><span className="pt" /><span>{failure} · fee released</span><time>{p.completed_at && time(p.completed_at)}</time></li>}
          {p.status === "failed" && <li><span className="pt bad" /><span>{failure} · fee released</span><time>{p.completed_at && time(p.completed_at)}</time></li>}
        </ol>
      </div>
      {p.status === "succeeded" && p.livemode && <Refunds payment={p} />}
      <CodeBlock tabs={[{ label: "GET /v1/stk-push/" + p.id.slice(0, 10) + "…", lang: "json", code: json }]} />
    </Drawer>
  );
}

// ---------- refunds ----------
/** Money sent back to the paying phone from the payout float, in parts if needed. */
function Refunds({ payment }: { payment: Payment }) {
  const me = useAccount();
  const { data: refunds } = useApi<Payout[]>(`/app/payments/${payment.id}/refunds`);
  const [open, setOpen] = useState(false);
  const sent = (refunds ?? []).filter((r) => r.status !== "failed" && r.status !== "reversed").reduce((t, r) => t + r.amount, 0);
  const left = payment.amount - sent;
  return (
    <div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="eyebrow">Refunds</div>
        {can(me, "money") && left >= 10 && (
          <button className="btn btn-line btn-sm" onClick={() => setOpen(true)}>
            <Icon name="undo" size={14} /> Refund
          </button>
        )}
      </div>
      {refunds?.length ? (
        <div className="stack" style={{ gap: 8 }}>
          {refunds.map((r) => (
            <div key={r.id} className="spread" style={{ fontSize: 13.5 }}>
              <span className="num">{money(r.amount)}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="muted">{dateTime(r.created_at)}</span>
                <PayoutBadge s={r.status} />
              </span>
            </div>
          ))}
          <p className="hint">{left > 0 ? `${money(left)} can still be refunded.` : "Fully refunded."}</p>
        </div>
      ) : (
        <p className="hint">Send all or part of this payment back to {maskPhone(payment.phone)} from your payout float.</p>
      )}
      <RefundModal open={open} onClose={() => setOpen(false)} payment={payment} left={left} />
    </div>
  );
}

function RefundModal({ open, onClose, payment, left }: { open: boolean; onClose: () => void; payment: Payment; left: number }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);
  const [conf, setConf] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (open) {
      setAmount(String(left));
      setError(null);
      setBusy(false);
      setConf(null);
    }
  }, [open, left]);
  const amt = Math.floor(Number(amount) || 0);
  const f = b2cFee(amt);
  const body = { action: "refund", mode: "live", payment: payment.id, amount: amt };

  async function send(code?: string) {
    await api<Payout>(`/app/payments/${payment.id}/refund`, { body: { mode: "live", amount: amt, code } });
    invalidate(`/app/payments/${payment.id}`, "/app/payouts", "/app/me", "/app/wallet", "/app/ledger");
    toast(`${money(amt)} refund on its way to ${maskPhone(payment.phone)}`);
    onClose();
  }

  async function start() {
    if (amt < 10) return setError("M-Pesa sends refunds from KES 10.");
    if (amt > left) return setError(`At most ${money(left)} can be refunded.`);
    setBusy(true);
    setError(null);
    try {
      const c = await api<Confirmation>("/app/confirmations", { body });
      if (c.required) setConf(c);
      else await send();
    } catch (err) {
      setError(err as ApiError);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refund payment"
      footer={
        conf ? (
          <button className="btn btn-line" onClick={() => setConf(null)}>Back</button>
        ) : (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" disabled={busy} onClick={start}>
              {busy ? <span className="spinner" /> : "Continue"}
            </button>
          </>
        )
      }
    >
      {conf ? (
        <SmsConfirm conf={conf} summary={`Refund ${money(amt)} to ${maskPhone(payment.phone)}`} onCode={send} onResend={() => api("/app/confirmations", { body })} />
      ) : (
        <>
          <div className="field">
            <div className="label-row">
              <label className="label" htmlFor="rf-amt">Amount</label>
              <button className="text-btn" onClick={() => setAmount(String(left))}>
                Full {money(left)}
              </button>
            </div>
            <div className="input-group">
              <span className="prefix">KES</span>
              <input id="rf-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <KV
            rows={[
              ["To", <span key="p" className="mono">{maskPhone(payment.phone)}</span>],
              ["Original payment", <span key="o" className="num">{money(payment.amount)} · {payment.mpesa_receipt}</span>],
              ["Fee", f === null ? "—" : <span key="f" className="num">{money(f)}</span>],
            ]}
          />
          <p className="hint">Refunds go out as M-Pesa B2C from your payout float. Your SwiftPal fee on the original payment isn't returned.</p>
          <ActionError error={error} />
        </>
      )}
    </Modal>
  );
}

// ---------- top up ----------
export function TopUpModal({ open, onClose, initial = "fee" }: { open: boolean; onClose: () => void; initial?: "fee" | "float" }) {
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const [account, setAccount] = useState<"fee" | "float">(initial);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const payment = usePaymentWatch(paymentId);

  useEffect(() => {
    if (open) {
      setAccount(initial);
      setAmount(initial === "fee" ? "500" : "10000");
      setPhone(me.user.phone);
      setPaymentId(null);
      setBusy(false);
      setError("");
    }
  }, [open, initial, me.user.phone]);

  useEffect(() => {
    if (!payment || payment.status === "pending") return;
    // Stop watching first: the refresh below refetches this payment and would re-run the effect.
    setPaymentId(null);
    if (payment.status === "succeeded") {
      invalidate("/app/wallet", "/app/ledger", "/app/me");
      toast(`${money(payment.amount)} added to ${account === "fee" ? "fee credit" : "payout float"}`);
      onClose();
    } else {
      setError(payment.failure_message ? `The top-up didn't go through: ${payment.failure_message}.` : "The top-up didn't go through.");
    }
  }, [payment, account, toast, onClose]);

  const amt = Math.floor(Number(amount) || 0);

  async function submit() {
    if (amt < 10) return setError("Top up at least KES 10.");
    const p = normalisePhone(phone);
    if (!p) return setError("Enter the M-Pesa number to charge.");
    setError("");
    setBusy(true);
    try {
      const pay = await api<Payment>("/app/wallet/topups", { body: { mode, account, amount: amt, phone: p } });
      setPaymentId(pay.id);
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  const waiting = !!paymentId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Top up"
      footer={
        !waiting ? (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner" /> : "Send M-Pesa prompt"}
            </button>
          </>
        ) : undefined
      }
    >
      {!waiting ? (
        <>
          <div className="segmented" role="group" aria-label="Balance">
            <button aria-pressed={account === "fee"} onClick={() => setAccount("fee")}>Fee credit</button>
            <button aria-pressed={account === "float"} onClick={() => setAccount("float")}>Payout float</button>
          </div>
          <p className="hint" style={{ marginTop: -6 }}>
            {account === "fee" ? "Pays SwiftPal fees on STK Push and B2C. Not withdrawable." : "Funds B2C payouts. Withdrawable any time."}
          </p>
          <div className="field">
            <label className="label" htmlFor="tu-amt">Amount</label>
            <div className="input-group">
              <span className="prefix">KES</span>
              <input id="tu-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="amount-chips">
              {(account === "fee" ? [250, 500, 1000, 5000] : [5000, 10000, 50000, 100000]).map((a) => (
                <button key={a} type="button" onClick={() => setAmount(String(a))}>{a.toLocaleString()}</button>
              ))}
            </div>
            {account === "fee" && amt >= 10 && <span className="hint">Covers about {Math.floor(amt / 2.5).toLocaleString()} successful STK Push payments.</span>}
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
  const me = useAccount();
  const mode = useMode();
  const toast = useToast();
  const bal = me.balances[mode];
  const float = bal.payout_float.available;
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);
  const [conf, setConf] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (open) {
      setAmount("");
      setError(null);
      setBusy(false);
      setConf(null);
    }
  }, [open]);
  const amt = Math.floor(Number(amount) || 0);
  const f = b2cFee(amt);
  const max = Math.floor(Math.min(float, 250_000));

  async function send(code?: string) {
    await api<Payout>("/app/wallet/withdraw", { body: { mode, amount: amt, code } });
    invalidate("/app/me", "/app/wallet", "/app/ledger", "/app/payouts");
    toast(`${money(amt)} on its way to ${me.withdraw_to}`);
    onClose();
  }

  /** Live withdrawals are confirmed with the authenticator app (or an SMS code where that's on). */
  async function start() {
    if (f === null) return setError("Withdraw between KES 10 and KES 250,000.");
    if (amt > float) return setError(`You have ${money(float)} available.`);
    setBusy(true);
    setError(null);
    try {
      if (mode === "test") await send();
      else {
        const c = await api<Confirmation>("/app/confirmations", { body: { action: "withdraw", mode, amount: amt } });
        if (c.required) setConf(c);
        else await send();
      }
    } catch (err) {
      setError(err as ApiError);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withdraw payout float"
      footer={
        conf ? (
          <button className="btn btn-line" onClick={() => setConf(null)}>Back</button>
        ) : (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" disabled={busy} onClick={start}>
              {busy ? <span className="spinner" /> : mode === "live" ? "Continue" : "Withdraw"}
            </button>
          </>
        )
      }
    >
      {conf ? (
        <SmsConfirm
          conf={conf}
          summary={`Withdraw ${money(amt)} to ${me.withdraw_to}`}
          onCode={send}
          onResend={() => api("/app/confirmations", { body: { action: "withdraw", mode, amount: amt } })}
        />
      ) : (
        <>
          <div className="field">
            <div className="label-row">
              <label className="label" htmlFor="wd-amt">Amount</label>
              <button className="text-btn" onClick={() => setAmount(String(max))}>
                Max {money(max)}
              </button>
            </div>
            <div className="input-group">
              <span className="prefix">KES</span>
              <input id="wd-amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <KV
            rows={[
              ["To", <span key="p" className="mono">{me.withdraw_to}</span>],
              ["Fee", f === null ? "—" : <span key="f" className="num">{money(f)}</span>],
            ]}
          />
          <p className="hint">Withdrawals only go to the account owner&apos;s verified number.</p>
          <ActionError error={error} />
        </>
      )}
    </Modal>
  );
}

// ---------- single payout ----------
export function PayoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mode = useMode();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("withdrawal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);
  const [conf, setConf] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (open) {
      setPhone("");
      setAmount("1500");
      setReference(`WD-${Math.floor(Math.random() * 90000 + 10000)}`);
      setError(null);
      setBusy(false);
      setConf(null);
    }
  }, [open, mode]);
  const amt = Math.floor(Number(amount) || 0);
  const f = b2cFee(amt);
  const to = normalisePhone(phone);
  const body = { mode, phone: to, amount: amt, reference: reference.trim() || "PAYOUT", reason };

  async function send(code?: string) {
    await api<Payout>("/app/payouts", { body: { ...body, code } });
    invalidate("/app/payouts", "/app/me", "/app/wallet", "/app/ledger");
    toast(`${money(amt)} payout to ${maskPhone(to!)} is processing`);
    onClose();
  }

  async function start() {
    if (!to) return setError("Enter a Safaricom number.");
    if (f === null) return setError("Payouts run from KES 10 to KES 250,000.");
    setBusy(true);
    setError(null);
    try {
      if (mode === "test") await send();
      else {
        const c = await api<Confirmation>("/app/confirmations", { body: { action: "payout", ...body } });
        if (c.required) setConf(c);
        else await send();
      }
    } catch (err) {
      setError(err as ApiError);
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a payout"
      footer={
        conf ? (
          <button className="btn btn-line" onClick={() => setConf(null)}>Back</button>
        ) : (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" disabled={busy} onClick={start}>
              {busy ? <span className="spinner" /> : mode === "live" ? "Continue" : <>Send {amt ? money(amt) : "payout"}</>}
            </button>
          </>
        )
      }
    >
      {conf ? (
        <SmsConfirm
          conf={conf}
          summary={`Send ${money(amt)} to ${to}`}
          onCode={send}
          onResend={() => api("/app/confirmations", { body: { action: "payout", ...body } })}
        />
      ) : (
        <>
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
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="po-ref">Reference</label>
            <input id="po-ref" className="input mono" maxLength={32} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <KV rows={[["Fee", f === null ? "—" : <span key="f" className="num">{money(f)}</span>]]} />
          <ActionError error={error} />
        </>
      )}
    </Modal>
  );
}
