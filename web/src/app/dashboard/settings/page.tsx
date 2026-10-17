"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, useToast } from "@/components/dash/ui";
import { normalisePhone } from "@/lib/format";
import { resetPrototype, saveBusiness, updateAccount, useStore, type Business } from "@/lib/store";

const TABS = [
  { v: "profile", t: "Profile" },
  { v: "business", t: "Business" },
  { v: "team", t: "Team" },
  { v: "danger", t: "Preview data" },
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
          {tab === "danger" && <Danger />}
        </div>
      </div>
    </>
  );
}

function Profile() {
  const s = useStore();
  const toast = useToast();
  const [f, setF] = useState({ firstName: s.account?.firstName ?? "", lastName: s.account?.lastName ?? "", phone: s.account?.phone ?? "" });
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <div className="panel-head"><h3>Profile</h3></div>
      <div className="panel-body form-grid">
        <div className="field"><label className="label" htmlFor="fn">First name</label><input id="fn" className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ln">Last name</label><input id="ln" className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="em">Email</label><input id="em" className="input" value={s.account?.email ?? ""} disabled /><span className="hint">Contact support to change your sign-in email.</span></div>
        <div className="field"><label className="label" htmlFor="ph">M-Pesa phone</label><input id="ph" className="input mono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><span className="hint">Used for top-ups, verification prompts and withdrawals.</span></div>
        {error && <div className="form-error full">{error}</div>}
      </div>
      <div className="modal-foot">
        <button
          className="btn btn-ink"
          onClick={() => {
            const p = normalisePhone(f.phone);
            if (!p) return setError("Enter a Safaricom number.");
            setError("");
            updateAccount({ firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: p });
            toast("Profile saved");
          }}
        >
          Save changes
        </button>
      </div>
    </section>
  );
}

function BusinessTab() {
  const s = useStore();
  const toast = useToast();
  const [b, setB] = useState<Business>(s.business ?? { type: "individual", name: "", industry: "", monthlyVolume: "", website: "" });
  return (
    <section className="panel">
      <div className="panel-head"><h3>Business</h3></div>
      <div className="panel-body form-grid">
        <div className="field full"><label className="label" htmlFor="bn">Business name</label><input id="bn" className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></div>
        <div className="field">
          <label className="label" htmlFor="bt">Type</label>
          <select id="bt" className="select input" value={b.type} onChange={(e) => setB({ ...b, type: e.target.value as Business["type"] })}>
            <option value="individual">Individual / sole proprietor</option>
            <option value="company">Registered company</option>
            <option value="ngo">NGO, school or church</option>
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="bi">Industry</label><input id="bi" className="input" value={b.industry} onChange={(e) => setB({ ...b, industry: e.target.value })} /></div>
        <div className="field full"><label className="label" htmlFor="bw">Website or app</label><input id="bw" className="input" value={b.website} placeholder="https://" onChange={(e) => setB({ ...b, website: e.target.value })} /></div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ink" onClick={() => { saveBusiness(b); toast("Business details saved"); }}>Save changes</button>
      </div>
    </section>
  );
}

function VerifyCard() {
  const s = useStore();
  const label = s.verification === "approved" ? "Verified" : s.verification === "submitted" ? "In review" : "Not verified";
  const tone = s.verification === "approved" ? "ok" : s.verification === "submitted" ? "info" : "warn";
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
  const s = useStore();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Team</h3>
        <button className="btn btn-line btn-sm" disabled title="Coming with the backend">
          <Icon name="plus" size={14} /> Invite
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Access</th></tr></thead>
          <tbody>
            <tr>
              <td>
                <b style={{ fontWeight: 500 }}>{s.account?.firstName} {s.account?.lastName}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>{s.account?.email}</div>
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

function Danger() {
  const router = useRouter();
  return (
    <section className="panel panel-body stack">
      <b>Reset preview data</b>
      <p className="muted" style={{ fontSize: 14 }}>
        This preview keeps your account, channels and transactions in this browser only. Resetting clears everything and signs you
        out, so you can walk through sign-up again.
      </p>
      <div>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (confirm("Clear all preview data?")) {
              resetPrototype();
              router.push("/");
            }
          }}
        >
          Reset everything
        </button>
      </div>
    </section>
  );
}
