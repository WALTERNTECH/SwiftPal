"use client";

import { PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";

type System = { live_mpesa: boolean; sms: boolean; email: boolean; verification_codes: boolean; storage: string; admin_gateway: boolean; environment: string };

const ROWS: { k: keyof System; t: string; fix: string }[] = [
  { k: "live_mpesa", t: "Live M-Pesa (Daraja)", fix: "DARAJA_* variables on swiftpal-api" },
  { k: "email", t: "Email (Resend)", fix: "RESEND_API_KEY and MAIL_FROM on swiftpal-api" },
  { k: "sms", t: "SMS (Africa's Talking)", fix: "AT_USERNAME and AT_API_KEY on swiftpal-api" },
  { k: "verification_codes", t: "Sign-up and sign-in codes", fix: "VERIFICATION_CODES=on once email and SMS work" },
  { k: "admin_gateway", t: "Console gateway lock", fix: "ADMIN_GATEWAY_SECRET on swiftpal-api and swiftpal-admin" },
];

export default function SystemPage() {
  const { data: s } = useApi<System>("/system");
  return (
    <>
      <PageHeader title="System" sub={s ? `Environment: ${s.environment}` : undefined} />
      <section className="panel">
        <div className="health">
          {ROWS.map((r) => (
            <div key={r.k}>
              <span>
                <b style={{ fontWeight: 500 }}>{r.t}</b>
                {s && !s[r.k] && <div className="muted" style={{ fontSize: 12 }}>Set {r.fix}</div>}
              </span>
              {s ? <span className={`badge ${s[r.k] ? "ok" : "warn"}`}>{s[r.k] ? "On" : "Off"}</span> : <span className="spinner" />}
            </div>
          ))}
          <div>
            <span>
              <b style={{ fontWeight: 500 }}>Document storage</b>
              {s?.storage === "db" && <div className="muted" style={{ fontSize: 12 }}>In the database. Set SUPABASE_SERVICE_ROLE_KEY to use the private bucket.</div>}
            </span>
            {s && <span className={`badge ${s.storage === "supabase" ? "ok" : ""}`}>{s.storage === "supabase" ? "Supabase bucket" : "Database"}</span>}
          </div>
        </div>
      </section>
    </>
  );
}
