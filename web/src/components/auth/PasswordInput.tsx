"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

export function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 16) s++;
  return s;
}

export function PasswordInput({
  value,
  onChange,
  id,
  autoComplete,
  invalid,
  meter,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  autoComplete: string;
  invalid?: boolean;
  meter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  return (
    <>
      <div className="pw-wrap">
        <input
          id={id}
          className="input"
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
          <Icon name={show ? "eyeOff" : "eye"} size={16} />
        </button>
      </div>
      {meter && value.length > 0 && (
        <div className={`pw-meter ${score < 3 ? "weak" : ""}`} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i < score ? "on" : ""} />
          ))}
        </div>
      )}
    </>
  );
}
