"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { maskPhone } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { addChannel, useStore, verifyChannel } from "@/lib/store";
import { Modal } from "./ui";

type Stage = "details" | "prompt" | "confirm" | "done";

/** Add a Till or Paybill and verify it with a KES 1 prompt, in three short steps. */
export function ChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [kind, setKind] = useState<"till" | "paybill">("till");
  const [shortcode, setShortcode] = useState("");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>("details");
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const firstChannel = !s.starterCreditGiven;

  useEffect(() => {
    if (!open) return;
    setStage("details");
    setShortcode("");
    setAccount("");
    setName((s.business?.name ?? "").toUpperCase());
    setError("");
  }, [open, s.business?.name]);

  function send() {
    if (!/^\d{5,7}$/.test(shortcode)) return setError(`Enter a 5 to 7 digit ${kind === "till" ? "till" : "paybill"} number.`);
    if (kind === "paybill" && !account.trim()) return setError("Enter the account number for this paybill.");
    if (!name.trim()) return setError("Enter the name registered to this " + kind + ".");
    if (s.channels.some((c) => c.shortcode === shortcode)) return setError("That number is already added.");
    setError("");
    setId(
      addChannel({
        kind,
        shortcode,
        accountNumber: kind === "paybill" ? account.trim() : undefined,
        label: `${kind === "till" ? "Till" : "Paybill"} ${shortcode}`,
        displayName: name.trim().toUpperCase(),
      }),
    );
    setStage("prompt");
    setTimeout(() => setStage("confirm"), 2600);
  }

  const steps = ["Details", "Prompt", "Confirm"];
  const at = stage === "details" ? 0 : stage === "prompt" ? 1 : 2;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add payment channel"
      width={520}
      footer={
        stage === "details" ? (
          <>
            <button className="btn btn-line" onClick={onClose}>Cancel</button>
            <button className="btn btn-pine" onClick={send}>Send KES 1 prompt</button>
          </>
        ) : stage === "confirm" ? (
          <>
            <button className="btn btn-line" onClick={() => setStage("details")}>Name was different</button>
            <button
              className="btn btn-pine"
              onClick={() => {
                verifyChannel(id);
                setStage("done");
              }}
            >
              <Icon name="check" size={15} /> Confirm
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
          <b>Prompt sent to {maskPhone(s.account?.phone ?? "")}</b>
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
        </div>
      )}
    </Modal>
  );
}
