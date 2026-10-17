"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { api, invalidate, useAccount, usePaymentWatch, type ApiError, type Channel, type Payment } from "@/lib/api";
import { maskPhone } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { Modal } from "./ui";

/** Add a Till or Paybill and verify it with a KES 1 prompt, in three short steps. */
export function ChannelModal({ open, onClose, retry }: { open: boolean; onClose: () => void; retry?: Channel | null }) {
  const me = useAccount();
  const [kind, setKind] = useState<"till" | "paybill">("till");
  const [shortcode, setShortcode] = useState("");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const payment = usePaymentWatch(paymentId);
  const [firstChannel, setFirstChannel] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(retry?.kind ?? "till");
    setShortcode(retry?.shortcode ?? "");
    setAccount(retry?.account_number ?? "");
    setName(retry?.display_name ?? me.merchant.name.toUpperCase());
    setChannel(retry ?? null);
    setPaymentId(null);
    setDone(false);
    setLiveKey(null);
    setBusy(false);
    setError("");
    setFirstChannel(!me.merchant.starter_credit_given);
    // Only when the modal opens; a refreshed account mustn't reset a half-done flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, retry]);

  useEffect(() => {
    if (payment && ["failed", "cancelled", "expired"].includes(payment.status)) {
      setError(payment.failure_message ? `The prompt didn't go through: ${payment.failure_message}.` : "The prompt didn't go through. Try again.");
      setPaymentId(null);
    }
  }, [payment]);

  const stage = done ? "done" : payment?.status === "succeeded" ? "confirm" : paymentId ? "prompt" : "details";

  async function send() {
    if (!/^\d{5,7}$/.test(shortcode)) return setError(`Enter a 5 to 7 digit ${kind === "till" ? "till" : "paybill"} number.`);
    if (kind === "paybill" && !account.trim()) return setError("Enter the account number for this paybill.");
    if (!name.trim()) return setError("Enter the name registered to this " + kind + ".");
    setError("");
    setBusy(true);
    try {
      let ch = channel;
      if (ch && (ch.shortcode !== shortcode || ch.kind !== kind || (ch.account_number ?? "") !== account.trim() || ch.display_name !== name.trim().toUpperCase())) {
        await api(`/app/channels/${ch.id}`, { method: "DELETE" });
        ch = null;
      }
      if (!ch) {
        ch = await api<Channel>("/app/channels", { body: { kind, shortcode, account_number: kind === "paybill" ? account.trim() : undefined, display_name: name.trim() } });
        setChannel(ch);
        invalidate("/app/me", "/app/channels");
      }
      const v = await api<{ channel: Channel; payment: Payment | null }>(`/app/channels/${ch.id}/verify`, { method: "POST" });
      setChannel(v.channel);
      if (v.payment) setPaymentId(v.payment.id);
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  async function confirm() {
    if (!channel) return;
    setBusy(true);
    try {
      const r = await api<{ channel: Channel; live_key: string | null }>(`/app/channels/${channel.id}/confirm`, { method: "POST" });
      setChannel(r.channel);
      setLiveKey(r.live_key);
      setDone(true);
      invalidate("/app/me", "/app/channels", "/app/keys", "/app/wallet", "/app/ledger");
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  const steps = ["Details", "Prompt", "Confirm"];
  const at = stage === "details" ? 0 : stage === "prompt" ? 1 : 2;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={retry ? "Verify payment channel" : "Add payment channel"}
      width={520}
      footer={
        stage === "details" ? (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" onClick={send} disabled={busy}>
              {busy ? <span className="spinner" /> : "Send KES 1 prompt"}
            </button>
          </>
        ) : stage === "confirm" ? (
          <>
            <button className="btn btn-line" onClick={() => setPaymentId(null)}>Name was different</button>
            <button className="btn btn-pine" onClick={confirm} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={15} />} Confirm
            </button>
          </>
        ) : stage === "done" ? (
          <button className="btn btn-ink" onClick={onClose}>Done</button>
        ) : undefined
      }
    >
      <ol className="mstep" aria-label="Progress">
        {steps.map((t, i) => (
          <li key={t} className={i < at || stage === "done" ? "done" : i === at ? "now" : ""}>
            <span>{i < at || stage === "done" ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}</span>
            {t}
          </li>
        ))}
      </ol>

      {stage === "details" && (
        <>
          <div className="segmented" role="group" aria-label="Type" style={{ justifySelf: "start" }}>
            <button aria-pressed={kind === "till"} onClick={() => setKind("till")}>Till · Buy Goods</button>
            <button aria-pressed={kind === "paybill"} onClick={() => setKind("paybill")}>Paybill</button>
          </div>
          <div className={kind === "paybill" ? "form-grid" : "stack"}>
            <div className="field">
              <label className="label" htmlFor="ch-sc">{kind === "till" ? "Till number" : "Paybill number"}</label>
              <input id="ch-sc" className="input mono" inputMode="numeric" placeholder={kind === "till" ? "5521093" : "247247"} value={shortcode} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, "").slice(0, 7))} />
            </div>
            {kind === "paybill" && (
              <div className="field">
                <label className="label" htmlFor="ch-acc">Account number</label>
                <input id="ch-acc" className="input mono" maxLength={20} value={account} onChange={(e) => setAccount(e.target.value)} />
              </div>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="ch-name">Registered name</label>
            <input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      )}

      {stage === "prompt" && (
        <div className="prompt-wait">
          <div className="prompt-ring"><Icon name="phone" size={22} /></div>
          <b>Prompt sent to {maskPhone(me.user.phone)}</b>
          <span className="muted">Approve KES 1 to {name.toUpperCase()}</span>
          <div className="prompt-dots"><i /><i /><i /></div>
        </div>
      )}

      {stage === "confirm" && (
        <div className="prompt-wait">
          <div className="prompt-ring on"><Icon name="info" size={22} /></div>
          <b>Did the prompt show “{name.toUpperCase()}”?</b>
          <span className="muted">
            {kind === "till" ? "Till" : "Paybill"} {shortcode}
            {kind === "paybill" ? ` · Acc ${account}` : ""}
          </span>
          {error && <div className="form-error">{error}</div>}
        </div>
      )}

      {stage === "done" && (
        <div className="prompt-wait">
          <svg className="done-check" viewBox="0 0 52 52" aria-hidden>
            <circle cx="26" cy="26" r="23" pathLength={1} />
            <path d="M15 27l7 7 15-16" pathLength={1} />
          </svg>
          <b>{kind === "till" ? "Till" : "Paybill"} {shortcode} verified</b>
          <span className="muted">{firstChannel ? `Live STK Push is on. KES ${STARTER_CREDIT} credit added.` : "Ready for live STK Push."}</span>
          {liveKey && (
            <div className="keybox" style={{ width: "100%", textAlign: "left" }}>
              <div className="keybox-head">
                <span className="badge ok">Live</span>
                <span className="muted" style={{ fontSize: 13 }}>Your live secret key. It&apos;s shown once.</span>
              </div>
              <div className="keybox-row">
                <code className="secret" style={{ wordBreak: "break-all" }}>{liveKey}</code>
                <span className="keybox-copy"><CopyButton text={liveKey} /></span>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
