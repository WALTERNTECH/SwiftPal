"use client";

import { useState, type ReactNode } from "react";
import type { ApiError } from "@/lib/api";
import { CodeInput, useCooldown } from "./CodeInput";

/** The shared "enter the 6-digit code" step: phone, email and sign-in. */
export function VerifyCode({
  title,
  sentTo,
  onVerify,
  onResend,
  aside,
  initialError = "",
}: {
  title: string;
  sentTo: ReactNode;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<unknown>;
  aside?: ReactNode;
  initialError?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [note, setNote] = useState("");
  const [attempt, setAttempt] = useState(0);
  const cooldown = useCooldown(30);

  async function verify(code: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await onVerify(code);
    } catch (e) {
      setError((e as ApiError).message);
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div className="auth-form">
      <div className="auth-head">
        <h1>{title}</h1>
        <p>Enter the 6-digit code sent to {sentTo}.</p>
      </div>
      <CodeInput onComplete={verify} disabled={busy} invalid={!!error} resetKey={attempt} />
      {error && <div className="form-error" role="alert">{error}</div>}
      {note && !error && <p className="hint">{note}</p>}
      <div className="auth-links">
        <button
          type="button"
          className="text-btn"
          disabled={cooldown.left > 0}
          onClick={async () => {
            setError("");
            try {
              await onResend();
              setNote("New code sent.");
            } catch (e) {
              setError((e as ApiError).message);
            }
            cooldown.restart();
          }}
        >
          {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend code"}
        </button>
        {aside}
      </div>
      {busy && (
        <div style={{ display: "grid", placeItems: "center" }}>
          <span className="spinner" />
        </div>
      )}
    </div>
  );
}
