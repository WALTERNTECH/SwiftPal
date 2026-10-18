"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyCode } from "@/components/auth/VerifyCode";
import { api, clearCache, nextStep, useMe } from "@/lib/api";

export default function VerifyEmail() {
  const router = useRouter();
  const { data: me, error } = useMe();
  const ready = me && me.user.phone_verified_at && !me.user.email_verified_at;

  useEffect(() => {
    if (error?.status === 401) router.replace("/signup");
    else if (me && !ready) router.replace(nextStep(me));
  }, [error, me, ready, router]);

  return (
    <AuthShell>
      {!ready ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 160 }}>
          <span className="spinner" />
        </div>
      ) : (
        <VerifyCode
          title="Check your email"
          sentTo={<b>{me.user.email}</b>}
          onVerify={async (code) => {
            await api("/app/auth/verify-email", { body: { code } });
            clearCache();
            router.push("/onboarding");
          }}
          onResend={() => api("/app/auth/resend", { method: "POST" })}
          aside={
            <button
              type="button"
              className="text-btn quiet"
              onClick={async () => {
                await api("/app/auth/logout", { method: "POST" }).catch(() => {});
                clearCache();
                router.push("/signup");
              }}
            >
              Use a different email
            </button>
          }
        />
      )}
    </AuthShell>
  );
}
