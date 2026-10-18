"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CodeInput, useCooldown } from "@/components/auth/CodeInput";
import { Icon } from "@/components/Icon";
import type { ApiError } from "@/lib/api";
import { phoneHint } from "@/lib/format";

/** What /app/confirmations answers: no step, the authenticator app, or a texted code. */
export type Confirmation = { required: boolean; method?: "totp" | "sms"; phone_hint?: string };

/**
 * Second step of live money leaving the account: the current code from the
 * authenticator app, or (before two-step is set up, where SMS is on) the code
 * texted to the account's number.
 */
export function SmsConfirm({ conf, summary, onCode, onResend }: { conf: Confirmation; summary: ReactNode; onCode: (code: string) => Promise<void>; onResend?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const cooldown = useCooldown(30);
  const totp = conf.method === "totp";

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="sms-confirm-head">
        <span className="sms-confirm-ic">
          <Icon name={totp ? "shield" : "lock"} size={16} />
        </span>
        <div>
          <b>{summary}</b>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            {totp ? (
              "Enter the 6-digit code from your authenticator app."
            ) : (
              <>
                Enter the code sent to <span className="mono">{phoneHint(conf.phone_hint ?? "")}</span>.
              </>
            )}
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
        {!totp && onResend ? (
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
        ) : (
          <span className="hint">Codes change every 30 seconds.</span>
        )}
        {busy && <span className="spinner" />}
      </div>
    </div>
  );
}

/** An action's error, with the way forward when the account first needs two-step verification. */
export function ActionError({ error }: { error: ApiError | string | null }) {
  if (!error) return null;
  const e = typeof error === "string" ? { code: "", message: error } : error;
  if (e.code === "two_factor_required")
    return (
      <div className="callout warn">
        <Icon name="shield" size={16} />
        <div>
          <b>Turn on two-step verification first</b>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Money only leaves a SwiftPal account after a code from your authenticator app. It takes a minute to set up.
          </p>
          <Link href="/dashboard/settings?tab=security" className="btn btn-pine btn-sm" style={{ marginTop: 10 }}>
            Set up two-step verification
          </Link>
        </div>
      </div>
    );
  return <div className="form-error">{e.message}</div>;
}
