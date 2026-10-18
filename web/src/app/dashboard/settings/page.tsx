"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { ActivityLog } from "@/components/dash/ActivityLog";
import { SecuritySettings } from "@/components/dash/SecuritySettings";
import { TeamSettings } from "@/components/dash/TeamSettings";
import { Modal, PageHeader, useToast } from "@/components/dash/ui";
import { api, can, invalidate, useAccount, type ApiError, type Merchant } from "@/lib/api";
import { normalisePhone, phoneHint } from "@/lib/format";

const TABS = [
  { v: "profile", t: "Profile" },
  { v: "security", t: "Security" },
  { v: "business", t: "Business" },
  { v: "team", t: "Team" },
  { v: "activity", t: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["v"];

export default function Settings() {
  const me = useAccount();
  const [tab, setTab] = useState<Tab>("profile");
  // The account-wide log is for the people who run the account.
  const tabs = TABS.filter((t) => t.v !== "activity" || can(me, "settings"));
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.v === t)) setTab(t as Tab);
  }, []);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          {tabs.map((t) => (
            <button key={t.v} aria-current={tab === t.v} onClick={() => setTab(t.v)}>
              {t.t}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ gap: 20 }}>
          {tab === "profile" && <VerifyCard />}
          {tab === "profile" && <Profile onSecurity={() => setTab("security")} />}
          {tab === "security" && <SecuritySettings />}
          {tab === "business" && <BusinessTab />}
          {tab === "team" && <TeamSettings />}
          {tab === "activity" && <ActivityLog />}
        </div>
      </div>
    </>
  );
}

function Profile({ onSecurity }: { onSecurity: () => void }) {
  const me = useAccount();
  const toast = useToast();
  const [f, setF] = useState({ firstName: me.user.first_name, lastName: me.user.last_name });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head"><h3>Profile</h3></div>
      <div className="panel-body form-grid">
        <div className="field"><label className="label" htmlFor="fn">First name</label><input id="fn" className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ln">Last name</label><input id="ln" className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="em">Business email</label><input id="em" className="input" value={me.user.email} disabled /></div>
        <div className="field">
          <label className="label" htmlFor="ph">Phone number</label>
          <div className="input-group">
            <input id="ph" className="input mono" style={{ borderRadius: "var(--r) 0 0 var(--r)" }} value={phoneHint(me.user.phone)} disabled />
            <button className="btn btn-line" style={{ height: 40, borderRadius: "0 var(--r) var(--r) 0", borderLeft: 0 }} onClick={() => setChanging(true)}>
              Change
            </button>
          </div>
        </div>
        {error && <div className="form-error full">{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={onSecurity}>Password and security</button>
        <button
          className="btn btn-pine"
          disabled={busy}
          onClick={async () => {
            if (!f.firstName.trim() || !f.lastName.trim()) return setError("Enter your first and last name.");
            setError("");
            setBusy(true);
            try {
              await api("/app/me", { method: "PATCH", body: { first_name: f.firstName.trim(), last_name: f.lastName.trim() } });
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
      <PhoneChange open={changing} onClose={() => setChanging(false)} />
    </section>
  );
}

/** A code to the current number authorises the move; a code to the new one proves it. */
function PhoneChange({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAccount();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [codes, setCodes] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPhone("");
      setSent(null);
      setCodes({ current: "", next: "" });
      setError("");
      setBusy(false);
    }
  }, [open]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change phone number"
      footer={
        <>
          <button className="btn btn-line" onClick={onClose}>Cancel</button>
          {!sent ? (
            <button
              className="btn btn-pine"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const p = normalisePhone(phone);
                  if (!p) throw new Error("Enter a valid Safaricom number.");
                  await api("/app/me/phone", { body: { phone: p } });
                  setSent(p);
                })
              }
            >
              {busy ? <span className="spinner" /> : "Send codes"}
            </button>
          ) : (
            <button
              className="btn btn-pine"
              disabled={busy || codes.current.length !== 6 || codes.next.length !== 6}
              onClick={() =>
                run(async () => {
                  await api("/app/me/phone/confirm", { body: { phone: sent, current_code: codes.current, new_code: codes.next } });
                  await invalidate("/app/me");
                  toast("Phone number updated");
                  onClose();
                })
              }
            >
              {busy ? <span className="spinner" /> : "Confirm"}
            </button>
          )}
        </>
      }
    >
      {!sent ? (
        <div className="field">
          <label className="label" htmlFor="new-ph">New phone number</label>
          <div className="input-group">
            <span className="prefix">+254</span>
            <input id="new-ph" className="input mono" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="code-cur">Code sent to {phoneHint(me.user.phone)}</label>
            <input id="code-cur" className="input mono" inputMode="numeric" autoComplete="one-time-code" value={codes.current} onChange={(e) => setCodes({ ...codes, current: digits(e.target.value) })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="code-new">Code sent to {phoneHint(sent)}</label>
            <input id="code-new" className="input mono" inputMode="numeric" value={codes.next} onChange={(e) => setCodes({ ...codes, next: digits(e.target.value) })} />
          </div>
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
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
          className="btn btn-pine"
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
  const label = vs === "approved" ? "Verified" : vs === "submitted" ? "Under review" : vs === "rejected" ? "Unsuccessful" : "Not verified";
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
