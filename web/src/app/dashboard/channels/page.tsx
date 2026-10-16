"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Empty, Modal, PageHeader, useToast } from "@/components/dash/ui";
import { maskPhone } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { addChannel, removeChannel, setDefaultChannel, useStore, verifyChannel } from "@/lib/store";

export default function Channels() {
  const s = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Channels"
        sub="The Tills and Paybills your STK Push payments settle into. Payments go straight to them, never through SwiftPal."
        actions={
          <button className="btn btn-ink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Add channel
          </button>
        }
      />

      {s.channels.length ? (
        <div className="tile-grid">
          {s.channels.map((c) => (
            <div key={c.id} className="panel channel-card">
              <div className="spread">
                <span className={`tag ${c.kind === "till" ? "post" : "get"}`}>{c.kind === "till" ? "TILL · BUY GOODS" : "PAYBILL"}</span>
                {c.status === "verified" ? <span className="badge ok">Verified</span> : <span className="badge warn">Unverified</span>}
              </div>
              <div>
                <div className="num" style={{ fontSize: 26, fontWeight: 500 }}>{c.shortcode}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>{c.displayName}</div>
              </div>
              <div className="kv" style={{ fontSize: 13 }}>
                <div><dt>Channel ID</dt><dd className="mono">{c.id}</dd></div>
                {c.kind === "paybill" && <div><dt>Account no.</dt><dd className="mono">{c.accountNumber ?? "Payment reference"}</dd></div>}
                <div><dt>Default</dt><dd>{c.isDefault ? "Yes, used when no channel is sent" : "No"}</dd></div>
              </div>
              <div className="row wrap">
                {c.status !== "verified" && (
                  <button className="btn btn-pine btn-sm" onClick={() => { verifyChannel(c.id); toast(`${c.shortcode} verified`); }}>
                    Verify with KES 1
                  </button>
                )}
                {!c.isDefault && (
                  <button className="btn btn-line btn-sm" onClick={() => { setDefaultChannel(c.id); toast("Default channel updated"); }}>
                    Make default
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (confirm(`Remove ${c.label}? New payments can't be routed to it.`)) {
                      removeChannel(c.id);
                      toast("Channel removed");
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon="channel"
            title="No channels yet"
            body={`Add the Till or Paybill you already use. We verify it with a KES 1 prompt to your phone, and you get KES ${STARTER_CREDIT} live credit.`}
            action={<button className="btn btn-ink" onClick={() => setAdding(true)}>Add your first channel</button>}
          />
        </section>
      )}

      <div className="callout info">
        <Icon name="info" size={16} />
        <span>
          Send <code className="inline-code">channel</code> with a payment to route it to a specific Till or Paybill. Leave it out and
          the default channel is used.
        </span>
      </div>

      <AddChannel open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddChannel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<"till" | "paybill">("till");
  const [shortcode, setShortcode] = useState("");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"form" | "sent" | "confirm">("form");
  const [id, setId] = useState("");
  const [error, setError] = useState("");

  const close = () => {
    setStage("form");
    setShortcode("");
    setAccount("");
    setName("");
    setError("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a channel"
      footer={
        stage === "form" ? (
          <>
            <button className="btn btn-line" onClick={close}>Cancel</button>
            <button
              className="btn btn-ink"
              onClick={() => {
                if (!/^\d{5,7}$/.test(shortcode)) return setError("Enter a 5 to 7 digit number.");
                if (!name.trim()) return setError("Enter the name shown on your M-Pesa statement.");
                if (s.channels.some((c) => c.shortcode === shortcode)) return setError("That number is already added.");
                const newId = addChannel({
                  kind,
                  shortcode,
                  accountNumber: kind === "paybill" ? account || undefined : undefined,
                  label: `${kind === "till" ? "Till" : "Paybill"} ${shortcode}`,
                  displayName: name.trim().toUpperCase(),
                });
                setId(newId);
                setError("");
                setStage("sent");
                setTimeout(() => setStage("confirm"), 2200);
              }}
            >
              Send KES 1 prompt
            </button>
          </>
        ) : stage === "confirm" ? (
          <>
            <button className="btn btn-line" onClick={close}>Name was wrong</button>
            <button
              className="btn btn-pine"
              onClick={() => {
                verifyChannel(id);
                toast(`${shortcode} verified`);
                close();
              }}
            >
              Yes, that&apos;s my business
            </button>
          </>
        ) : undefined
      }
    >
      {stage === "form" && (
        <>
          <div className="segmented" role="group" aria-label="Type">
            <button aria-pressed={kind === "till"} onClick={() => setKind("till")}>Till · Buy Goods</button>
            <button aria-pressed={kind === "paybill"} onClick={() => setKind("paybill")}>Paybill</button>
          </div>
          <div className="field">
            <label className="label" htmlFor="ch-sc">{kind === "till" ? "Till number" : "Paybill number"}</label>
            <input id="ch-sc" className="input mono" inputMode="numeric" value={shortcode} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </div>
          {kind === "paybill" && (
            <div className="field">
              <label className="label" htmlFor="ch-acc">Default account number <span className="dim">(optional)</span></label>
              <input id="ch-acc" className="input mono" maxLength={12} value={account} onChange={(e) => setAccount(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="ch-name">Name on your M-Pesa statement</label>
            <input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      )}
      {stage === "sent" && (
        <div className="empty" style={{ padding: 20 }}>
          <div className="empty-icon"><span className="spinner" /></div>
          <b>Prompt sent to {maskPhone(s.account?.phone ?? "")}</b>
          <p className="muted">Approve the KES 1 payment. It lands in your own {kind}.</p>
        </div>
      )}
      {stage === "confirm" && (
        <div className="stack">
          <b>Did the prompt say “Pay Ksh1.00 to {name.toUpperCase()}”?</b>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Safaricom shows the name registered to the {kind}. If it&apos;s someone else&apos;s name, this {kind} isn&apos;t yours and we
            won&apos;t route payments to it.
          </p>
        </div>
      )}
    </Modal>
  );
}
