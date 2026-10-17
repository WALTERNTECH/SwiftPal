"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell, NextSteps } from "@/components/auth/AuthShell";
import { api, clearCache, useMe, type ApiError } from "@/lib/api";

export default function VerifyEmail() {
  const router = useRouter();
  const { data: me, error } = useMe();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (error?.status === 401) router.replace("/signup");
    if (me?.user.email_verified_at) router.replace(me.merchant.onboarding_done ? "/dashboard" : "/onboarding");
  }, [error, me, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  async function complete(code: string) {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api("/app/auth/verify-email", { body: { code } });
      clearCache();
      router.push("/onboarding");
    } catch (e) {
      setErr((e as ApiError).message);
      setDigits(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
      setBusy(false);
    }
  }

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      const filled = [...next, ...Array(6 - next.length).fill("")];
      setDigits(filled);
      refs.current[Math.min(next.length, 5)]?.focus();
      complete(filled.join(""));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    complete(next.join(""));
  }

  return (
    <AuthShell side={<NextSteps />}>
      <div className="auth-form">
        <div>
          <h1>Check your email</h1>
          <p className="sub">
            We sent a 6-digit code to <b style={{ color: "var(--ink)" }}>{me?.user.email ?? "your email"}</b>. It expires in 10 minutes.
          </p>
        </div>
        <div
          className="otp"
          onPaste={(e) => {
            e.preventDefault();
            setAt(0, e.clipboardData.getData("text"));
          }}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="input"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              aria-invalid={err ? true : undefined}
              maxLength={6}
              value={d}
              disabled={busy}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              }}
            />
          ))}
        </div>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-ink btn-lg btn-block" disabled={digits.join("").length !== 6 || busy} onClick={() => complete(digits.join(""))}>
          {busy ? <span className="spinner" /> : "Verify email"}
        </button>
        <div className="spread" style={{ fontSize: 13.5 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={cooldown > 0}
            onClick={async () => {
              setErr("");
              try {
                await api("/app/auth/resend", { method: "POST" });
                setNote("A new code is on its way. Check spam if it doesn't arrive.");
              } catch (e) {
                setErr((e as ApiError).message);
              }
              setCooldown(30);
            }}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await api("/app/auth/logout", { method: "POST" }).catch(() => {});
              clearCache();
              router.push("/signup");
            }}
          >
            Use a different email
          </button>
        </div>
        {note && <p className="hint">{note}</p>}
      </div>
    </AuthShell>
  );
}
