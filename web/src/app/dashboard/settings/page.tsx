"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, useToast } from "@/components/dash/ui";
import { normalisePhone } from "@/lib/format";
import {
  approveVerification,
  resetPrototype,
  saveBusiness,
  submitVerification,
  updateAccount,
  useStore,
  type Business,
} from "@/lib/store";

const TABS = [
  { v: "profile", t: "Profile" },
  { v: "business", t: "Business" },
  { v: "verification", t: "Verification" },
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
          {tab === "profile" && <Profile />}
          {tab === "business" && <BusinessTab />}
          {tab === "verification" && <VerificationTab />}
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

function VerificationTab() {
  const s = useStore();
  const toast = useToast();
  const company = s.business?.type !== "individual";
  const [f, setF] = useState({ idNumber: "", kraPin: "", regNumber: "", director: "" });
  const [files, setFiles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  if (s.verification === "approved") {
    return (
      <section className="panel panel-body">
        <div className="row"><span className="badge ok">Approved</span><b>Live payouts are enabled</b></div>
        <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>Your live keys can now use the <code className="inline-code">payouts:write</code> scope.</p>
      </section>
    );
  }

  if (s.verification === "submitted") {
    return (
      <section className="panel panel-body stack">
        <div className="row"><span className="badge info">In review</span><b>We&apos;re checking your details</b></div>
        <p className="muted" style={{ fontSize: 14 }}>
          Most reviews finish within a few business hours. We&apos;ll email {s.account?.email} as soon as live payouts are on. STK Push
          and the sandbox keep working in the meantime.
        </p>
        <div className="callout">
          <Icon name="info" size={16} />
          <span className="grow">Preview build: approval normally comes from the SwiftPal admin console. You can simulate it here.</span>
          <button className="btn btn-line btn-sm" onClick={() => { approveVerification(); toast("Verification approved"); }}>Simulate approval</button>
        </div>
      </section>
    );
  }

  const fileField = (k: string, label: string, hint: string) => (
    <div className="field full">
      <span className="label">{label}</span>
      <label className="dropzone" style={{ padding: 16, justifyItems: "start", textAlign: "left" }}>
        <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && setFiles({ ...files, [k]: e.target.files[0].name })} />
        <span className="row" style={{ gap: 8 }}>
          <Icon name={files[k] ? "check" : "upload"} size={16} />
          <b style={{ color: "var(--ink)", fontWeight: 500 }}>{files[k] ?? "Choose a file"}</b>
        </span>
        <span>{hint}</span>
      </label>
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Business verification</h3>
          <p className="muted" style={{ fontSize: 13 }}>Required for live B2C payouts only. STK Push and the sandbox don&apos;t need it.</p>
        </div>
      </div>
      <div className="panel-body form-grid">
        {company ? (
          <>
            <div className="field"><label className="label" htmlFor="rn">Registration number</label><input id="rn" className="input mono" placeholder="PVT-XXXXXXX" value={f.regNumber} onChange={(e) => setF({ ...f, regNumber: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor="kp">Company KRA PIN</label><input id="kp" className="input mono" placeholder="P051234567X" value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value.toUpperCase() })} /></div>
            <div className="field"><label className="label" htmlFor="dr">Director&apos;s full name</label><input id="dr" className="input" value={f.director} onChange={(e) => setF({ ...f, director: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor="di">Director&apos;s ID number</label><input id="di" className="input mono" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value.replace(/\D/g, "") })} /></div>
            {fileField("cert", "Certificate of incorporation", "PDF or photo, up to 10 MB")}
            {fileField("cr12", "CR12 (issued in the last 12 months)", "Lists directors and shareholders")}
          </>
        ) : (
          <>
            <div className="field"><label className="label" htmlFor="id">National ID number</label><input id="id" className="input mono" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="field"><label className="label" htmlFor="kp">KRA PIN</label><input id="kp" className="input mono" placeholder="A012345678Z" value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value.toUpperCase() })} /></div>
            {fileField("id_front", "ID, front and back", "One PDF or two photos")}
          </>
        )}
        {error && <div className="form-error full">{error}</div>}
      </div>
      <div className="modal-foot">
        <button
          className="btn btn-ink"
          onClick={() => {
            if (!/^[AP]\d{9}[A-Z]$/.test(f.kraPin)) return setError("A KRA PIN looks like A012345678Z.");
            if (f.idNumber.length < 6) return setError("Enter a valid ID number.");
            if (company && !f.regNumber.trim()) return setError("Enter the registration number.");
            const need = company ? ["cert", "cr12"] : ["id_front"];
            if (need.some((k) => !files[k])) return setError("Attach the documents listed above.");
            setError("");
            submitVerification();
            toast("Submitted for review");
          }}
        >
          Submit for review
        </button>
      </div>
    </section>
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
