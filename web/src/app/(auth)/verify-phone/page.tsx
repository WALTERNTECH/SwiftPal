"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyCode } from "@/components/auth/VerifyCode";
import { api, clearCache, invalidate, nextStep, useMe } from "@/lib/api";
import { phoneHint } from "@/lib/format";

export default function VerifyPhone() {
  const router = useRouter();
  const { data: me, error } = useMe();

  useEffect(() => {
    if (error?.status === 401) router.replace("/signup");
    else if (me?.user.phone_verified_at) router.replace(nextStep(me));
  }, [error, me, router]);

  return (
    <AuthShell>
      {!me || me.user.phone_verified_at ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 160 }}>
          <span className="spinner" />
        </div>
      ) : (
        <VerifyCode
          title="Verify your phone"
          sentTo={<b className="mono">{phoneHint(me.user.phone)}</b>}
          onVerify={async (code) => {
            await api("/app/auth/verify-phone", { body: { code } });
            await invalidate("/app/me");
            router.push("/verify-email");
          }}
          onResend={() => api("/app/auth/resend-phone", { method: "POST" })}
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
              Wrong number?
            </button>
          }
        />
      )}
    </AuthShell>
  );
}
