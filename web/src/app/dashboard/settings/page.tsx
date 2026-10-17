"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, useToast } from "@/components/dash/ui";
import { api, invalidate, useAccount, type ApiError, type Merchant } from "@/lib/api";
import { normalisePhone } from "@/lib/format";

const TABS = [
  { v: "profile", t: "Profile" },
  { v: "business", t: "Business" },
  { v: "team", t: "Team" },
  { v: "sandbox", t: "Sandbox" },
] as const;
type Tab = (typeof TABS)[number]["v"];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("profile");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.v === t)) setTab(t as Tab);
  }, []);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t.v} aria-current={tab === t.v} onClick={() => setTab(t.v)}>
              {t.t}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ gap: 20 }}>
          {tab === "profile" && <VerifyCard />}
          {tab === "profile" && <Profile />}
          {tab === "business" && <BusinessTab />}
          {tab === "team" && <Team />}
          {tab === "sandbox" && <Sandbox />}
        </div>
      </div>
    </>
  );
}

function Profile() {
  const me = useAccount();
  const toast = useToast();
  const [f, setF] = useState({ firstName: me.user.first_name, lastName: me.user.last_name, phone: me.user.phone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <div className="panel-head"><h3>Profile</h3></div>
      <div className="panel-body form-grid">
        <div className="field"><label className="label" htmlFor="fn">First name</label><input id="fn" className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ln">Last name</label><input id="ln" className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="em">Email</label><input id="em" className="input" value={me.user.email} disabled /><span className="hint">Contact support to change your sign-in email.</span></div>
        <div className="field"><label className="label" htmlFor="ph">M-Pesa phone</label><input id="ph" className="input mono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><span className="hint">Used for top-ups, verification prompts and withdrawals.</span></div>
        {error && <div className="form-error full">{error}</div>}
      </div>
      <div className="modal-foot">
        <Link href="/forgot-password" className="btn btn-ghost" style={{ marginRight: "auto" }}>Change password</Link>
        <button
          className="btn btn-ink"
          disabled={busy}
          onClick={async () => {
            const p = normalisePhone(f.phone);
            if (!p) return setError("Enter a Safaricom number.");
            if (!f.firstName.trim() || !f.lastName.trim()) return setError("Enter your first and last name.");
            setError("");
            setBusy(true);
            try {
              await api("/app/me", { method: "PATCH", body: { first_name: f.firstName.trim(), last_name: f.lastName.trim(), phone: p } });
              invalidate("/app/me");
              toast("Profile saved");
            } catch (err) {
              setError((err as ApiError).message);
            }
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner" /> : "Save changes"}
        </button>
      </div>
    </section>
  );
}

function BusinessTab() {
  const me = useAccount();
  const toast = useToast();
  const m = me.merchant;
  const [b, setB] = useState({ name: m.name, type: m.type, industry: m.industry ?? "", website: m.website ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <div className="panel-head"><h3>Business</h3></div>
      <div className="panel-body form-grid">
        <div className="field full"><label className="label" htmlFor="bn">Business name</label><input id="bn" className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></div>
        <div className="field">
          <label className="label" htmlFor="bt">Type</label>
          <select id="bt" className="select input" value={b.type} onChange={(e) => setB({ ...b, type: e.target.value as Merchant["type"] })} disabled={m.verification_status === "approved"}>
            <option value="individual">Individual / sole proprietor</option>
            <option value="company">Registered company</option>
            <option value="ngo">NGO, school or church</option>
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="bi">Industry</label><input id="bi" className="input" value={b.industry} onChange={(e) => setB({ ...b, industry: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="bw">Website or app</label><input id="bw" className="input" value={b.website} placeholder="https://" onChange={(e) => setB({ ...b, website: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ac">Account code</label><input id="ac" className="input mono" value={m.account_code} disabled /><span className="hint">The reference on your top-ups.</span></div>
        {error && <div className="form-error full">{error}</div>}
      </div>
      <div className="modal-foot">
        <button
          className="btn btn-ink"
          disabled={busy}
          onClick={async () => {
            if (b.name.trim().length < 2) return setError("Enter the business name.");
            setError("");
            setBusy(true);
            try {
              await api("/app/merchant", { method: "PATCH", body: { name: b.name.trim(), type: b.type, industry: b.industry.trim(), website: b.website.trim() } });
              invalidate("/app/me");
              toast("Business details saved");
            } catch (err) {
              setError((err as ApiError).message);
            }
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner" /> : "Save changes"}
        </button>
      </div>
    </section>
  );
}

function VerifyCard() {
  const me = useAccount();
  const vs = me.merchant.verification_status;
  const label = vs === "approved" ? "Verified" : vs === "submitted" ? "In review" : vs === "rejected" ? "Needs changes" : "Not verified";
  const tone = vs === "approved" ? "ok" : vs === "submitted" ? "info" : vs === "rejected" ? "bad" : "warn";
  return (
    <Link href="/dashboard/verification" className="panel panel-body spread rise" style={{ alignItems: "center" }}>
      <span className="row">
        <span className={`st-ic ${tone}`} style={{ width: 30, height: 30, borderRadius: 9 }}>
          <Icon name="idcard" size={15} />
        </span>
        <span>
          <b style={{ display: "block", fontSize: 14 }}>Account verification</b>
          <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
        </span>
      </span>
      <Icon name="chevronRight" size={16} className="dim" />
    </Link>
  );
}

function Team() {
  const me = useAccount();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Team</h3>
        <button className="btn btn-line btn-sm" disabled title="Team invites aren't available yet">
          <Icon name="plus" size={14} /> Invite
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Access</th></tr></thead>
          <tbody>
            <tr>
              <td>
                <b style={{ fontWeight: 500 }}>{me.user.first_name} {me.user.last_name}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>{me.user.email}</div>
              </td>
              <td><span className="badge pine">Owner</span></td>
              <td className="muted">Everything, including keys and payouts</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel-body muted" style={{ fontSize: 13, borderTop: "1px solid var(--line)" }}>
        Roles planned: Developer (keys, webhooks, logs), Finance (payouts, wallet), Support (read-only transactions).
      </div>
    </section>
  );
}

function Sandbox() {
  const toast = useToast();
  const [busy, setBusy] = useState<"seed" | "reset" | null>(null);

  async function run(what: "seed" | "reset") {
    if (what === "reset" && !confirm("Clear all test-mode data and refill the test balances? Live data isn't touched.")) return;
    setBusy(what);
    try {
      await api(`/app/sandbox/${what}`, { method: "POST" });
      invalidate("/app/");
      toast(what === "seed" ? "Sample history loaded" : "Sandbox reset");
    } catch (err) {
      toast((err as ApiError).message, "alert");
    }
    setBusy(null);
  }

  return (
    <>
      <section className="panel panel-body stack">
        <b>Sample history</b>
        <p className="muted" style={{ fontSize: 14 }}>
          Adds sixty days of test payments and payouts so the overview and analytics have something to show. They&apos;re marked as samples and never touch live mode.
        </p>
        <div>
          <button className="btn btn-line" disabled={!!busy} onClick={() => run("seed")}>
            {busy === "seed" ? <span className="spinner" /> : "Load sample history"}
          </button>
        </div>
      </section>
      <section className="panel panel-body stack">
        <b>Reset sandbox</b>
        <p className="muted" style={{ fontSize: 14 }}>
          Deletes test payments, payouts, ledger entries, request logs and webhook deliveries, and refills the test balances. Keys, endpoints and channels stay.
        </p>
        <div>
          <button className="btn btn-danger" disabled={!!busy} onClick={() => run("reset")}>
            {busy === "reset" ? <span className="spinner" /> : "Reset test data"}
          </button>
        </div>
      </section>
    </>
  );
}
