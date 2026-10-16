"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell, NextSteps } from "@/components/auth/AuthShell";
import { signOut, useHydrated, useStore, verifyEmail } from "@/lib/store";

export default function VerifyEmail() {
  const router = useRouter();
  const s = useStore();
  const hydrated = useHydrated();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(30);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (hydrated && !s.account) router.replace("/signup");
  }, [hydrated, s.account, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const code = digits.join("");

  function complete(c: string) {
    if (c.length !== 6) return;
    setBusy(true);
    verifyEmail();
    setTimeout(() => router.push("/onboarding"), 500);
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
            We sent a 6-digit code to <b style={{ color: "var(--ink)" }}>{s.account?.email ?? "your email"}</b>. It expires in 10
            minutes.
          </p>
        </div>
        <div className="otp" onPaste={(e) => { e.preventDefault(); setAt(0, e.clipboardData.getData("text")); }}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              className="input"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
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
        <button className="btn btn-ink btn-lg btn-block" disabled={code.length !== 6 || busy} onClick={() => complete(code)}>
          {busy ? <span className="spinner" /> : "Verify email"}
        </button>
        <div className="spread" style={{ fontSize: 13.5 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={cooldown > 0}
            onClick={() => { setCooldown(30); setSent(true); }}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { signOut(); router.push("/signup"); }}>
            Use a different email
          </button>
        </div>
        {sent && <p className="hint">A new code is on its way. Check your spam folder if it doesn&apos;t arrive.</p>}
        <p className="hint" style={{ textAlign: "center" }}>Preview build: any 6 digits will verify.</p>
      </div>
    </AuthShell>
  );
}
