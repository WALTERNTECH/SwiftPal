"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { CodeInput } from "@/components/CodeInput";
import { api, clearCache, useMe, type ApiError } from "@/lib/api";

/** The second step: set up an authenticator app the first time, enter its code every time after. */
export default function TwoStep() {
  const router = useRouter();
  const { data: me, error } = useMe();
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (error?.status === 401) router.replace("/login");
    else if (me?.stage === "full") router.replace("/");
  }, [me, error, router]);

  useEffect(() => {
    if (me?.stage !== "enroll" || enroll) return;
    api<{ secret: string; otpauth_url: string }>("/auth/enroll")
      .then(async (e) => setEnroll({ secret: e.secret, qr: await QRCode.toDataURL(e.otpauth_url, { margin: 1, width: 368, errorCorrectionLevel: "M" }) }))
      .catch((err: ApiError) => setFailure(err.message));
  }, [me, enroll]);

  async function submit(code: string) {
    setBusy(true);
    setFailure("");
    try {
      await api(me?.stage === "enroll" ? "/auth/enroll" : "/auth/totp", { body: { code } });
      clearCache();
      router.replace("/");
    } catch (err) {
      setFailure((err as ApiError).message);
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  }

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    clearCache();
    router.replace("/login");
  };

  return (
    <AuthCard>
      {!me || me.stage === "full" ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 160 }}>
          <span className="spinner" />
        </div>
      ) : (
        <div className="auth-form">
          <div className="auth-head">
            <h1>{me.stage === "enroll" ? "Set up two-step sign-in" : "Enter your code"}</h1>
            <p>{me.stage === "enroll" ? "Scan with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code." : "Open your authenticator app and enter the 6-digit code for SwiftPal Admin."}</p>
          </div>
          {me.stage === "enroll" &&
            (enroll ? (
              <div className="qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="QR code for your authenticator app" />
                <span className="secret-key">{enroll.secret.match(/.{1,4}/g)?.join(" ")}</span>
              </div>
            ) : (
              <div style={{ display: "grid", placeItems: "center", minHeight: 120 }}>
                <span className="spinner" />
              </div>
            ))}
          <CodeInput onComplete={submit} disabled={busy} invalid={!!failure} resetKey={attempt} />
          {failure && <div className="form-error" role="alert">{failure}</div>}
          <div className="auth-links">
            <span />
            <button type="button" className="text-btn quiet" onClick={signOut}>
              Use another account
            </button>
          </div>
        </div>
      )}
    </AuthCard>
  );
}
