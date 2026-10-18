"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { api, invalidate, useAccount, useMode, type ApiError } from "@/lib/api";
import { ActionError } from "./SmsConfirm";
import { Modal } from "./ui";

const SCOPES = [
  { v: "payments:write", d: "STK Push" },
  { v: "payouts:write", d: "Payouts" },
  { v: "read", d: "Read-only" },
];

export function KeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAccount();
  const mode = useMode();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["payments:write", "read"]);
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);
  // Live keys are a second-factor action when two-step is on; ones that send money need it on.
  const needCode = mode === "live" && me.user.two_factor;
  const payoutsLocked = mode === "live" && me.merchant.verification_status !== "approved";
  const liveLocked = mode === "live" && !me.merchant.live_enabled;

  useEffect(() => {
    if (open) {
      setName("");
      setScopes(["payments:write", "read"]);
      setCode("");
      setFresh(null);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (fresh) {
    return (
      <Modal open={open} onClose={onClose} title="Copy your new key" footer={<button className="btn btn-pine" onClick={onClose}>Done</button>}>
        <div className="callout warn">
          <Icon name="alert" size={16} />
          <span>{mode === "live" ? "Shown once. Store it in your secrets manager." : "Store it in your secrets manager. Test keys stay visible under API keys."}</span>
        </div>
        <div className="keybox">
          <div className="keybox-row">
            <code className="secret" style={{ wordBreak: "break-all" }}>{fresh}</code>
            <span className="keybox-copy"><CopyButton text={fresh} /></span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New API key"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-pine"
            disabled={!name.trim() || !scopes.length || busy || liveLocked || (needCode && code.length !== 6)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const k = await api<{ id: string; secret: string }>("/app/keys", { body: { name: name.trim(), mode, scopes, code: needCode ? code : undefined } });
                invalidate("/app/keys");
                setFresh(k.secret);
              } catch (err) {
                setError(err as ApiError);
              }
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : "Create key"}
          </button>
        </>
      }
    >
      {liveLocked && (
        <div className="callout warn">
          <Icon name="alert" size={16} />
          <span>API keys open once your account is verified.</span>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="kn">Name</label>
        <input id="kn" className="input" placeholder="checkout-service" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
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
      {mode === "live" && scopes.includes("payouts:write") && !me.user.two_factor && (
        <p className="hint">Keys that send money need two-step verification on your account.</p>
      )}
      {needCode && (
        <div className="field">
          <label className="label" htmlFor="k2fa">Code from your authenticator app</label>
          <input id="k2fa" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
        </div>
      )}
      <ActionError error={error} />
    </Modal>
  );
}
