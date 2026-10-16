"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, NextSteps } from "@/components/auth/AuthShell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <AuthShell side={<NextSteps />}>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.includes("@")) setSent(true);
        }}
      >
        <div>
          <h1>Reset your password</h1>
          <p className="sub">
            {sent
              ? `If ${email} has an account, a reset link is on its way. It works for 30 minutes.`
              : "Enter the email you signed up with and we'll send a reset link."}
          </p>
        </div>
        {!sent && (
          <>
            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-ink btn-lg btn-block">Send reset link</button>
          </>
        )}
        <Link href="/login" className="link" style={{ fontSize: 14 }}>← Back to sign in</Link>
      </form>
    </AuthShell>
  );
}
