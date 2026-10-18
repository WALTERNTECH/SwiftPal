"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput, passwordScore } from "@/components/auth/PasswordInput";
import { api, clearCache, type ApiError } from "@/lib/api";
import { normalisePhone } from "@/lib/format";

type Errors = Partial<Record<"firstName" | "lastName" | "email" | "phone" | "password" | "terms", string>>;

export default function SignUp() {
  const router = useRouter();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const up = (k: keyof typeof f) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!f.firstName.trim()) e.firstName = "Required";
    if (!f.lastName.trim()) e.lastName = "Required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "Enter a valid email address";
    if (!normalisePhone(f.phone)) e.phone = "Enter a valid Safaricom number";
    if (f.password.length < 10) e.password = "Use at least 10 characters";
    else if (passwordScore(f.password) < 2) e.password = "Add upper and lower case letters, numbers or symbols";
    if (!terms) e.terms = "Accept the terms to continue";
    return e;
  }

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
      router.push("/verify-phone");
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
      alt={
        <>
          Already have an account? <Link className="link" href="/login">Sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-head">
          <h1>Create your account</h1>
        </div>

        <div className="auth-row">
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
          <label className="label" htmlFor="email">Business email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={f.email} aria-invalid={!!errors.email || undefined} onChange={(e) => up("email")(e.target.value)} />
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        <div className="field">
          <label className="label" htmlFor="phone">Phone number</label>
          <div className="input-group">
            <span className="prefix">+254</span>
            <input id="phone" className="input mono" type="tel" inputMode="tel" autoComplete="tel-national" value={f.phone} aria-invalid={!!errors.phone || undefined} onChange={(e) => up("phone")(e.target.value)} />
          </div>
          {errors.phone && <span className="error-text">{errors.phone}</span>}
        </div>

        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput id="password" autoComplete="new-password" value={f.password} onChange={up("password")} invalid={!!errors.password} meter />
          {errors.password && <span className="error-text">{errors.password}</span>}
        </div>

        <div className="field">
          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErrors((x) => ({ ...x, terms: undefined })); }} />
            <span>I agree to the Terms of Service and Privacy Policy.</span>
          </label>
          {errors.terms && <span className="error-text">{errors.terms}</span>}
        </div>

        {formError && <div className="form-error" role="alert">{formError}</div>}

        <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
