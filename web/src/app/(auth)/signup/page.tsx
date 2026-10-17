"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, NextSteps } from "@/components/auth/AuthShell";
import { PasswordInput, passwordScore } from "@/components/auth/PasswordInput";
import { normalisePhone } from "@/lib/format";
import { api, clearCache, type ApiError } from "@/lib/api";

type Errors = Partial<Record<"firstName" | "lastName" | "email" | "phone" | "password" | "terms", string>>;

export default function SignUp() {
  const router = useRouter();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const up = (k: keyof typeof f) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!f.firstName.trim()) e.firstName = "Enter your first name";
    if (!f.lastName.trim()) e.lastName = "Enter your last name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "Enter an email address like you@company.co.ke";
    if (!normalisePhone(f.phone)) e.phone = "Enter a Safaricom number, e.g. 0712 345 678";
    if (f.password.length < 10) e.password = "Use at least 10 characters";
    else if (passwordScore(f.password) < 2) e.password = "Mix upper and lower case, numbers or symbols";
    if (!terms) e.terms = "Accept the terms to continue";
    return e;
  }

  const [formError, setFormError] = useState("");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError("");
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      clearCache();
      await api("/app/auth/signup", {
        body: { first_name: f.firstName.trim(), last_name: f.lastName.trim(), email: f.email.trim().toLowerCase(), phone: normalisePhone(f.phone), password: f.password },
      });
      router.push("/verify-email");
    } catch (err) {
      const x = err as ApiError;
      if (x.code === "email_taken") setErrors({ email: x.message });
      else if (x.code === "invalid_phone") setErrors({ phone: x.message });
      else if (x.code === "weak_password") setErrors({ password: x.message });
      else setFormError(x.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      side={<NextSteps />}
      topRight={
        <span className="muted" style={{ fontSize: 14 }}>
          Have an account? <Link className="link" href="/login">Sign in</Link>
        </span>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div>
          <h1>Create your SwiftPal account</h1>
          <p className="sub">Free to start. Sandbox keys as soon as you verify your email.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="firstName">First name</label>
            <input id="firstName" className="input" autoComplete="given-name" value={f.firstName} aria-invalid={!!errors.firstName || undefined} onChange={(e) => up("firstName")(e.target.value)} />
            {errors.firstName && <span className="error-text">{errors.firstName}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="lastName">Last name</label>
            <input id="lastName" className="input" autoComplete="family-name" value={f.lastName} aria-invalid={!!errors.lastName || undefined} onChange={(e) => up("lastName")(e.target.value)} />
            {errors.lastName && <span className="error-text">{errors.lastName}</span>}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" placeholder="you@company.co.ke" value={f.email} aria-invalid={!!errors.email || undefined} onChange={(e) => up("email")(e.target.value)} />
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        <div className="field">
          <label className="label" htmlFor="phone">M-Pesa phone number</label>
          <div className="input-group">
            <span className="prefix">+254</span>
            <input id="phone" className="input mono" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="712 345 678" value={f.phone} aria-invalid={!!errors.phone || undefined} onChange={(e) => up("phone")(e.target.value)} />
          </div>
          {errors.phone ? <span className="error-text">{errors.phone}</span> : <span className="hint">We send verification and top-up prompts here.</span>}
        </div>

        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput id="password" autoComplete="new-password" value={f.password} onChange={up("password")} invalid={!!errors.password} meter />
          {errors.password ? <span className="error-text">{errors.password}</span> : <span className="hint">At least 10 characters.</span>}
        </div>

        <div className="field">
          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErrors((x) => ({ ...x, terms: undefined })); }} />
            <span>
              I agree to the SwiftPal terms of service and privacy policy, and confirm I&apos;m authorised to act for this business.
            </span>
          </label>
          {errors.terms && <span className="error-text">{errors.terms}</span>}
        </div>

        {formError && <div className="form-error" role="alert">{formError}</div>}

        <button className="btn btn-ink btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
