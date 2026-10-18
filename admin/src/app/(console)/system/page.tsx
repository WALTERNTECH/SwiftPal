"use client";

import { useEffect, useState } from "react";
import { PageHeader, useToast } from "@/components/ui";
import { api, invalidate, useApi, type ApiError } from "@/lib/api";

type System = { live_mpesa: boolean; sms: boolean; email: boolean; verification_codes: boolean; storage: string; admin_gateway: boolean; environment: string };
type Platform = { payouts_paused: boolean; payments_paused: boolean; signups_paused: boolean; announcement: { text: string; tone: "info" | "warning" } | null };

const ROWS: { k: keyof System; t: string; fix: string }[] = [
  { k: "live_mpesa", t: "Live M-Pesa (Daraja)", fix: "DARAJA_* variables on swiftpal-api" },
  { k: "email", t: "Email (Resend)", fix: "RESEND_API_KEY and MAIL_FROM on swiftpal-api" },
  { k: "sms", t: "SMS (Africa's Talking)", fix: "AT_USERNAME and AT_API_KEY on swiftpal-api" },
  { k: "verification_codes", t: "Sign-up and sign-in codes", fix: "VERIFICATION_CODES=on once email and SMS work" },
  { k: "admin_gateway", t: "Console gateway lock", fix: "ADMIN_GATEWAY_SECRET on swiftpal-api and the console" },
];

const SWITCHES: { k: "payouts_paused" | "payments_paused" | "signups_paused"; t: string; d: string }[] = [
  { k: "payouts_paused", t: "Pause payouts and withdrawals", d: "Every live B2C request is refused, from the API and the dashboard. Floats stay put. For a Safaricom B2C outage or a suspected attack." },
  { k: "payments_paused", t: "Pause payment prompts", d: "Live STK Push requests are refused. Payments already prompted still settle." },
  { k: "signups_paused", t: "Pause sign-ups", d: "New accounts can't be created. Existing merchants are unaffected." },
];

export default function SystemPage() {
  const toast = useToast();
  const { data: s } = useApi<System>("/system");
  const { data: p } = useApi<Platform>("/platform");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<"info" | "warning">("info");
  useEffect(() => {
    setText(p?.announcement?.text ?? "");
    setTone(p?.announcement?.tone ?? "info");
  }, [p?.announcement?.text, p?.announcement?.tone]);

  async function save(patch: Partial<Platform>, done: string) {
    setBusy(true);
    try {
      await api("/platform", { method: "PATCH", body: patch });
      await invalidate("/platform", "/overview", "/audit");
      toast(done);
    } catch (e) {
      toast((e as ApiError).message, "alert");
    }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="System" sub={s ? `Environment: ${s.environment}` : undefined} />

      <section className="panel">
        <div className="panel-head"><h3>Platform switches</h3><span className="muted" style={{ fontSize: 12.5 }}>Take effect within 5 seconds · audited</span></div>
        {SWITCHES.map((w) => {
          const on = !!p?.[w.k];
          return (
            <div key={w.k} className="switch-row">
              <div className="grow">
                <b>{w.t} {on && <span className="badge bad" style={{ marginLeft: 6 }}>Paused</span>}</b>
                <span className="muted">{w.d}</span>
              </div>
              <button
                className="toggle"
                role="switch"
                aria-checked={on}
                aria-label={w.t}
                disabled={busy || !p}
                onClick={() => (on || confirm(`${w.t}? This affects every merchant.`)) && save({ [w.k]: !on }, on ? "Resumed" : "Paused")}
              />
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Dashboard announcement</h3>{p?.announcement && <span className="badge info">Showing now</span>}</div>
        <div className="panel-body stack" style={{ gap: 12 }}>
          <textarea className="textarea" maxLength={280} placeholder="M-Pesa B2C is slow this evening. Payouts are delayed but safe." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <div className="seg-tabs" role="group">
              <button aria-current={tone === "info"} onClick={() => setTone("info")}>Info</button>
              <button aria-current={tone === "warning"} onClick={() => setTone("warning")}>Warning</button>
            </div>
            <span className="grow" />
            {p?.announcement && (
              <button className="btn btn-line" disabled={busy} onClick={() => save({ announcement: null }, "Announcement removed")}>Remove</button>
            )}
            <button className="btn btn-pine" disabled={busy || text.trim().length < 3} onClick={() => save({ announcement: { text: text.trim(), tone } }, "Announcement published")}>
              Publish
            </button>
          </div>
          <span className="hint">Shown at the top of every merchant&apos;s dashboard until removed.</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Services</h3></div>
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
