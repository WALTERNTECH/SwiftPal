"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { createKey, useStore, type ApiKey } from "@/lib/store";
import { Modal } from "./ui";

const SCOPES = [
  { v: "payments:write", d: "STK Push" },
  { v: "payouts:write", d: "Payouts" },
  { v: "read", d: "Read-only" },
];

export function KeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["payments:write", "read"]);
  const [fresh, setFresh] = useState<ApiKey | null>(null);
  const payoutsLocked = s.mode === "live" && s.verification !== "approved";

  useEffect(() => {
    if (open) {
      setName("");
      setScopes(["payments:write", "read"]);
      setFresh(null);
    }
  }, [open]);

  if (fresh) {
    return (
      <Modal open={open} onClose={onClose} title="Copy your new key" footer={<button className="btn btn-ink" onClick={onClose}>Done</button>}>
        <div className="callout warn">
          <Icon name="alert" size={16} />
          <span>Shown once. Store it in your secrets manager.</span>
        </div>
        <div className="keybox">
          <div className="keybox-row">
            <code className="secret" style={{ wordBreak: "break-all" }}>{fresh.secret}</code>
            <span className="keybox-copy"><CopyButton text={fresh.secret} /></span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New ${s.mode} key`}
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button className="btn btn-pine" disabled={!name.trim() || !scopes.length} onClick={() => setFresh(createKey(name.trim(), s.mode, scopes))}>
            Create key
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="kn">Name</label>
        <input id="kn" className="input" placeholder="checkout-service" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Scopes</legend>
        <div className="scope-pick">
          {SCOPES.map((sc) => {
            const disabled = sc.v === "payouts:write" && payoutsLocked;
            const on = scopes.includes(sc.v);
            return (
              <label key={sc.v} className={`scope-opt ${on ? "on" : ""} ${disabled ? "off" : ""}`}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={on}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, sc.v] : scopes.filter((x) => x !== sc.v))}
                />
                <code>{sc.v}</code>
                <span>{disabled ? "Needs verification" : sc.d}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Modal>
  );
}
