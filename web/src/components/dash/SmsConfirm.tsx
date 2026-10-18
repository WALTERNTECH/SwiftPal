"use client";

import { useState, type ReactNode } from "react";
import { CodeInput, useCooldown } from "@/components/auth/CodeInput";
import { Icon } from "@/components/Icon";
import type { ApiError } from "@/lib/api";
import { phoneHint } from "@/lib/format";

/** Second step of a live payout or withdrawal: the code texted to the account's number. */
export function SmsConfirm({ hint, summary, onCode, onResend }: { hint: string; summary: ReactNode; onCode: (code: string) => Promise<void>; onResend: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const cooldown = useCooldown(30);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="sms-confirm-head">
        <span className="sms-confirm-ic">
          <Icon name="lock" size={16} />
        </span>
        <div>
          <b>{summary}</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            Enter the code sent to <span className="mono">{phoneHint(hint)}</span>.
          </p>
        </div>
      </div>
      <CodeInput
        resetKey={attempt}
        disabled={busy}
        invalid={!!error}
        onComplete={async (code) => {
          setBusy(true);
          setError("");
          try {
            await onCode(code);
          } catch (e) {
            setError((e as ApiError).message);
            setAttempt((n) => n + 1);
          }
          setBusy(false);
        }}
      />
      {error && <div className="form-error">{error}</div>}
      <div className="spread">
        <button
          type="button"
          className="text-btn"
          disabled={cooldown.left > 0 || busy}
          onClick={async () => {
            setError("");
            try {
              await onResend();
            } catch (e) {
              setError((e as ApiError).message);
            }
            cooldown.restart();
          }}
        >
          {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend code"}
        </button>
        {busy && <span className="spinner" />}
      </div>
    </div>
  );
}
