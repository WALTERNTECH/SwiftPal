"use client";

import { useEffect, useState } from "react";
import { api, invalidate, type ApiError, type Payment, type Payout } from "@/lib/api";
import { money } from "@/lib/format";
import { Modal, useToast } from "./ui";

/** Credit or debit one balance by hand, with the reason on record. */
export function AdjustModal({ merchantId, open, onClose }: { merchantId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ account: "float" as "fee" | "float", direction: "credit" as "credit" | "debit", amount: "", reference: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setF({ account: "float", direction: "credit", amount: "", reference: "", reason: "" });
      setError("");
      setBusy(false);
    }
  }, [open]);
  const amount = Number(f.amount);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust balance"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${f.direction === "credit" ? "btn-pine" : "btn-danger"}`}
            disabled={busy}
            onClick={async () => {
              if (!(amount > 0)) return setError("Enter an amount.");
              if (f.reason.trim().length < 5) return setError("Say why, in a few words.");
              setBusy(true);
              setError("");
              try {
                await api(`/merchants/${merchantId}/adjust`, { body: { mode: "live", account: f.account, direction: f.direction, amount, reference: f.reference.trim() || undefined, reason: f.reason.trim() } });
                await invalidate(`/merchants/${merchantId}`, "/merchants", "/overview", "/audit");
                toast(`${f.direction === "credit" ? "Credited" : "Debited"} ${money(amount)}`);
                onClose();
              } catch (err) {
                setError((err as ApiError).message);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : f.direction === "credit" ? `Credit ${amount > 0 ? money(amount) : ""}` : `Debit ${amount > 0 ? money(amount) : ""}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <span className="label">Balance</span>
          <div className="segmented" role="group">
            <button aria-pressed={f.account === "float"} onClick={() => setF({ ...f, account: "float" })}>Payout float</button>
            <button aria-pressed={f.account === "fee"} onClick={() => setF({ ...f, account: "fee" })}>Fee credit</button>
          </div>
        </div>
        <div className="field">
          <span className="label">Direction</span>
          <div className="segmented" role="group">
            <button aria-pressed={f.direction === "credit"} onClick={() => setF({ ...f, direction: "credit" })}>Credit</button>
            <button aria-pressed={f.direction === "debit"} onClick={() => setF({ ...f, direction: "debit" })}>Debit</button>
          </div>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="adj-amt">Amount</label>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input id="adj-amt" className="input mono" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="adj-ref">M-Pesa receipt or reference</label>
          <input id="adj-ref" className="input mono" maxLength={60} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value.toUpperCase() })} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="adj-why">Reason</label>
        <textarea id="adj-why" className="textarea" maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

/** Settle a payment or payout by hand when M-Pesa's answer never reached SwiftPal. */
export function ResolveModal({ kind, item, onClose }: { kind: "payment" | "payout"; item: Payment | Payout | null; onClose: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("succeeded");
  const [receipt, setReceipt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (item) {
      setOutcome(kind === "payout" && (item as Payout).raw_status === "queued" ? "failed" : "succeeded");
      setReceipt("");
      setNote("");
      setError("");
      setBusy(false);
    }
  }, [item, kind]);
  if (!item) return null;
  const queued = kind === "payout" && (item as Payout).raw_status === "queued";
  const topup = kind === "payment" && (item as Payment).purpose === "topup";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Resolve ${kind} · ${money(item.amount)}`}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${outcome === "succeeded" ? "btn-pine" : "btn-danger"}`}
            disabled={busy}
            onClick={async () => {
              if (outcome === "succeeded" && !/^[A-Za-z0-9]{8,12}$/.test(receipt.trim())) return setError("Enter the M-Pesa receipt.");
              if (note.trim().length < 5) return setError("Say why, in a few words.");
              setBusy(true);
              setError("");
              try {
                await api(`/${kind === "payment" ? "payments" : "payouts"}/${item.id}/resolve`, { body: { outcome, receipt: receipt.trim() || undefined, note: note.trim() } });
                await invalidate("/payments", "/payouts", "/merchants", "/overview", "/audit");
                toast(outcome === "succeeded" ? "Marked as succeeded" : kind === "payout" ? "Failed and refunded" : "Closed as failed");
                onClose();
              } catch (err) {
                setError((err as ApiError).message);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : outcome === "succeeded" ? "Mark succeeded" : kind === "payout" ? "Fail and refund" : "Mark failed"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5 }}>
        {item.merchant_name ? <b style={{ color: "var(--ink)" }}>{item.merchant_name}</b> : null} · <span className="mono">{item.reference}</span> · <span className="mono">{item.phone}</span>
      </p>
      <div className="segmented" role="group" aria-label="Outcome" style={{ justifySelf: "start" }}>
        <button aria-pressed={outcome === "succeeded"} disabled={queued} onClick={() => setOutcome("succeeded")}>
          {kind === "payout" ? "Delivered" : "Paid"}
        </button>
        <button aria-pressed={outcome === "failed"} onClick={() => setOutcome("failed")}>
          {kind === "payout" ? "Failed · refund" : "Failed"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: -4 }}>
        {outcome === "succeeded"
          ? topup
            ? "Credits the merchant's wallet and charges any fee."
            : kind === "payout"
              ? "The amount and fee leave the merchant's float for good."
              : "Charges the fee and tells the merchant it was paid."
          : kind === "payout"
            ? "The amount and fee go back to the merchant."
            : "Releases any fee held for it."}
      </p>
      {outcome === "succeeded" && (
        <div className="field">
          <label className="label" htmlFor="rs-rc">M-Pesa receipt</label>
          <input id="rs-rc" className="input mono" maxLength={12} value={receipt} onChange={(e) => setReceipt(e.target.value.toUpperCase())} />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="rs-why">Reason</label>
        <textarea id="rs-why" className="textarea" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
