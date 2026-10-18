"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, invalidate, useAccount, type ApiError, type Channel } from "@/lib/api";
import { Modal, useToast } from "./ui";

/** Add a Till or Paybill. The account is already verified, so it takes payments straight away. */
export function ChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAccount();
  const toast = useToast();
  const approved = me.merchant.verification_status === "approved";
  const [kind, setKind] = useState<"till" | "paybill">("till");
  const [shortcode, setShortcode] = useState("");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind("till");
    setShortcode("");
    setAccount("");
    setName(me.merchant.name.toUpperCase());
    setBusy(false);
    setError("");
    // Only when the dialog opens; a refreshed account mustn't reset what's typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function add() {
    if (!/^\d{5,7}$/.test(shortcode)) return setError(`Enter a 5 to 7 digit ${kind} number.`);
    if (kind === "paybill" && !account.trim()) return setError("Enter the account number for this paybill.");
    if (!name.trim()) return setError(`Enter the name registered to this ${kind}.`);
    setBusy(true);
    setError("");
    try {
      const ch = await api<Channel>("/app/channels", { body: { kind, shortcode, account_number: kind === "paybill" ? account.trim() : undefined, display_name: name.trim() } });
      await invalidate("/app/me", "/app/channels");
      toast(`${ch.kind === "till" ? "Till" : "Paybill"} ${ch.shortcode} is receiving payments`);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  if (!approved) {
    return (
      <Modal open={open} onClose={onClose} title="Add Till or Paybill" footer={<button className="btn btn-line" onClick={onClose}>Close</button>}>
        <div className="callout">
          <Icon name="idcard" size={16} />
          <span className="grow">
            {me.merchant.verification_status === "submitted" ? "Available once your verification is approved." : "Verify your account first."}
          </span>
          {me.merchant.verification_status !== "submitted" && (
            <Link href="/dashboard/verification" className="btn btn-pine btn-sm" onClick={onClose}>
              Verify
            </Link>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Till or Paybill"
      width={480}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" onClick={add} disabled={busy}>
            {busy ? <span className="spinner" /> : "Add"}
          </button>
        </>
      }
    >
      <div className="segmented" role="group" aria-label="Type" style={{ justifySelf: "start" }}>
        <button aria-pressed={kind === "till"} onClick={() => setKind("till")}>Till · Buy Goods</button>
        <button aria-pressed={kind === "paybill"} onClick={() => setKind("paybill")}>Paybill</button>
      </div>
      <div className={kind === "paybill" ? "form-grid" : "stack"}>
        <div className="field">
          <label className="label" htmlFor="ch-sc">{kind === "till" ? "Till number" : "Paybill number"}</label>
          <input id="ch-sc" className="input mono" inputMode="numeric" value={shortcode} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, "").slice(0, 7))} />
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
    </Modal>
  );
}
