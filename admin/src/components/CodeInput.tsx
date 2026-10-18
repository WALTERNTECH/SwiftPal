"use client";

import { useEffect, useRef, useState } from "react";

/** Six boxes for a one-time code. Paste fills them all; the sixth digit calls onComplete. */
export function CodeInput({ onComplete, disabled, invalid, resetKey }: { onComplete: (code: string) => void; disabled?: boolean; invalid?: boolean; resetKey?: unknown }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // A wrong code clears the boxes and puts the cursor back at the start.
  useEffect(() => {
    setDigits(["", "", "", "", "", ""]);
    refs.current[0]?.focus();
  }, [resetKey]);

  function fill(from: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      const next = [...digits];
      next[from] = "";
      setDigits(next);
      return;
    }
    const next = [...digits];
    for (let i = 0; i < clean.length && from + i < 6; i++) next[from + i] = clean[i];
    setDigits(next);
    refs.current[Math.min(from + clean.length, 5)]?.focus();
    if (next.every(Boolean)) onComplete(next.join(""));
  }

  return (
    <div
      className="otp"
      onPaste={(e) => {
        e.preventDefault();
        fill(0, e.clipboardData.getData("text"));
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
          aria-invalid={invalid || undefined}
          placeholder=" "
          maxLength={6}
          value={d}
          disabled={disabled}
          onChange={(e) => fill(i, e.target.value.slice(-6))}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/** "Resend code" with a cooldown. */
export function useCooldown(seconds = 30) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, restart: () => setLeft(seconds) };
}
