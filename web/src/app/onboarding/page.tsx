"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VerificationWizard } from "@/components/dash/VerificationWizard";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { api, invalidate, needsCodes, nextStep, useMe, type ApiError, type Merchant } from "@/lib/api";
import "../dashboard/dashboard.css";
import "./onboarding.css";

const STEPS = [
  { t: "Your business", d: "Name and what you do" },
  { t: "Verify your identity", d: "ID and a selfie, or company documents" },
  { t: "Start receiving", d: "Add your Till or Paybill" },
];

async function finish() {
  await api("/app/merchant", { method: "PATCH", body: { onboarding_done: true } });
  await invalidate("/app/me");
}

export default function Onboarding() {
  const router = useRouter();
  const { data: me, error } = useMe();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (error?.status === 401) router.replace("/signup");
    else if (me && needsCodes(me)) router.replace(nextStep(me));
  }, [error, me, router]);

  if (!me) {
    return (
      <div className="onb" style={{ display: "grid", placeItems: "center" }}>
        {error && error.status !== 401 ? <p className="muted">{error.message}</p> : <span className="spinner" />}
      </div>
    );
  }

  const submitted = me.merchant.verification_status === "submitted" || me.merchant.verification_status === "approved";
  const open = async () => {
    await finish().catch(() => {});
    router.push("/dashboard");
  };

  return (
    <div className="onb">
      <header className="onb-top">
        <Logo href="/" />
        <span className="muted mono" style={{ fontSize: 12.5 }}>
          Step {step + 1} of {STEPS.length}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={open}>
          Skip to dashboard
        </button>
      </header>
      <div className="onb-body">
        <ol className="onb-rail" aria-label="Setup steps">
          {STEPS.map((st, i) => (
            <li key={st.t} className={i === step ? "now" : i < step ? "done" : ""}>
              <span className="onb-dot">{i < step ? <Icon name="check" size={12} strokeWidth={2.2} /> : i + 1}</span>
              <div>
                <b>{st.t}</b>
                <span>{st.d}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="onb-main">
          {step === 0 && <BusinessStep merchant={me.merchant} onNext={() => setStep(submitted ? 2 : 1)} />}
          {step === 1 && (
            <div className="onb-card wide">
              <div>
                <h1>Verify your identity</h1>
              </div>
              <VerificationWizard onSubmitted={() => setStep(2)} />
            </div>
          )}
          {step === 2 && <DoneStep approved={me.merchant.verification_status === "approved"} onOpen={open} />}
        </div>
      </div>
    </div>
  );
}

function DoneStep({ approved, onOpen }: { approved: boolean; onOpen: () => void }) {
  return (
    <div className="onb-card">
      <div className="onb-done">
        <span className="onb-done-ic">
          <Icon name={approved ? "check" : "clock"} size={22} strokeWidth={2.2} />
        </span>
        <div>
          <h1>{approved ? "Account verified" : "Documents submitted"}</h1>
          <p className="muted">{approved ? "Add your Till or Paybill to start receiving payments." : "Your verification is under review. Once it's approved, add your Till or Paybill to start receiving payments."}</p>
        </div>
      </div>
      <div className="onb-actions">
        <span />
        <button className="btn btn-pine btn-lg" onClick={onOpen}>
          Open dashboard <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TYPES: { v: Merchant["type"]; t: string; d: string }[] = [
  { v: "individual", t: "Individual", d: "Developer, freelancer or sole trader. Verified with your national ID." },
  { v: "company", t: "Registered company", d: "A limited company or partnership with a CR12." },
  { v: "ngo", t: "NGO, school or church", d: "A registered non-profit, institution or society." },
];

const INDUSTRIES = ["E-commerce", "SaaS / software", "Education & school fees", "Logistics & delivery", "Hospitality & events", "Health", "Savings group / chama", "Marketplace", "Other"];
const VOLUMES = [
  { v: "lt-100k", t: "Under KES 100,000" },
  { v: "100k-1m", t: "KES 100,000 – 1M" },
  { v: "1m-10m", t: "KES 1M – 10M" },
  { v: "gt-10m", t: "Over KES 10M" },
];

function BusinessStep({ merchant, onNext }: { merchant: Merchant; onNext: () => void }) {
  const [b, setB] = useState({
    type: merchant.type,
    name: merchant.name,
    industry: merchant.industry ?? "",
    monthlyVolume: merchant.monthly_volume ?? "",
    website: merchant.website ?? "",
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = b.name.trim().length > 1 && b.industry && b.monthlyVolume;

  return (
    <form
      className="onb-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        setBusy(true);
        setError("");
        try {
          await api("/app/merchant", { method: "PATCH", body: { name: b.name.trim(), type: b.type, industry: b.industry, monthly_volume: b.monthlyVolume, website: b.website.trim() } });
          await invalidate("/app/me");
          onNext();
        } catch (err) {
          setError((err as ApiError).message);
        }
        setBusy(false);
      }}
    >
      <div>
        <h1>Tell us about your business</h1>
        
      </div>

      <fieldset className="field">
        <legend className="label" style={{ marginBottom: 6 }}>Business type</legend>
        <div className="choice-grid">
          {TYPES.map((t) => (
            <label key={t.v} className={`choice ${b.type === t.v ? "on" : ""}`}>
              <input type="radio" name="type" value={t.v} checked={b.type === t.v} onChange={() => setB({ ...b, type: t.v })} />
              <b>{t.t}</b>
              <span>{t.d}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="bname">{b.type === "individual" ? "Project or trading name" : "Registered name"}</label>
        <input id="bname" className="input" value={b.name} placeholder="Njeri Home Stores" onChange={(e) => setB({ ...b, name: e.target.value })} aria-invalid={touched && b.name.trim().length < 2 ? true : undefined} />
        {touched && b.name.trim().length < 2 && <span className="error-text">Enter your business name</span>}
      </div>

      <div className="two">
        <div className="field">
          <label className="label" htmlFor="industry">What are you building?</label>
          <select id="industry" className="select input" value={b.industry} onChange={(e) => setB({ ...b, industry: e.target.value })} aria-invalid={touched && !b.industry ? true : undefined}>
            <option value="">Choose one</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          {touched && !b.industry && <span className="error-text">Choose an industry</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="volume">Expected monthly volume</label>
          <select id="volume" className="select input" value={b.monthlyVolume} onChange={(e) => setB({ ...b, monthlyVolume: e.target.value })} aria-invalid={touched && !b.monthlyVolume ? true : undefined}>
            <option value="">Choose one</option>
            {VOLUMES.map((v) => (
              <option key={v.v} value={v.v}>{v.t}</option>
            ))}
          </select>
          {touched && !b.monthlyVolume && <span className="error-text">Choose a range</span>}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="site">Website or app link <span className="dim">(optional)</span></label>
        <input id="site" className="input" placeholder="https://" value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} />
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="onb-actions">
        <span />
        <button className="btn btn-pine btn-lg" disabled={busy}>
          {busy ? <span className="spinner" /> : <>Continue <Icon name="arrowRight" size={15} /></>}
        </button>
      </div>
    </form>
  );
}
