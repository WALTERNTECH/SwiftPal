"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CodeBlock, CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { PhonePrompt, type PromptStage } from "@/components/PhonePrompt";
import { maskPhone } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { stkSnippets } from "@/lib/snippets";
import {
  addChannel,
  finishOnboarding,
  saveBusiness,
  simulateStk,
  useHydrated,
  useStore,
  verifyChannel,
  type Business,
  type BusinessType,
} from "@/lib/store";
import "./onboarding.css";

const STEPS = [
  { t: "Your business", d: "Who you are and what you're building" },
  { t: "Where money lands", d: "Your Till or Paybill" },
  { t: "Your keys", d: "Send a first test payment" },
];

export default function Onboarding() {
  const s = useStore();
  const hydrated = useHydrated();
  const router = useRouter();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!hydrated) return;
    if (!s.account || !s.signedIn) router.replace("/signup");
    else if (!s.account.emailVerified) router.replace("/verify-email");
  }, [hydrated, s.account, s.signedIn, router]);

  if (!hydrated || !s.account) return null;

  return (
    <div className="onb">
      <header className="onb-top">
        <Logo href="/" />
        <span className="muted mono" style={{ fontSize: 12.5 }}>
          Step {step + 1} of {STEPS.length}
        </span>
        <Link
          href="/dashboard"
          className="btn btn-ghost btn-sm"
          onClick={() => finishOnboarding()}
        >
          Skip to dashboard
        </Link>
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
          {step === 0 && <BusinessStep onNext={() => setStep(1)} />}
          {step === 1 && <ChannelStep onBack={() => setStep(0)} onNext={() => setStep(2)} />}
          {step === 2 && (
            <KeysStep
              onBack={() => setStep(1)}
              onDone={() => {
                finishOnboarding();
                router.push("/dashboard");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TYPES: { v: BusinessType; t: string; d: string }[] = [
  { v: "individual", t: "Individual or sole proprietor", d: "You trade under your own name or a registered business name." },
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

function BusinessStep({ onNext }: { onNext: () => void }) {
  const s = useStore();
  const [b, setB] = useState<Business>(
    s.business ?? { type: "individual", name: "", industry: "", monthlyVolume: "", website: "" },
  );
  const [touched, setTouched] = useState(false);
  const valid = b.name.trim().length > 1 && b.industry && b.monthlyVolume;

  return (
    <form
      className="onb-card"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        saveBusiness({ ...b, name: b.name.trim() });
        onNext();
      }}
    >
      <div>
        <h1>Tell us about your business</h1>
        <p className="muted">This sets your defaults. You won&apos;t need documents until you turn on live payouts.</p>
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
        <label className="label" htmlFor="bname">{b.type === "individual" ? "Business or trading name" : "Registered name"}</label>
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

      <div className="onb-actions">
        <span />
        <button className="btn btn-ink btn-lg">
          Continue <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

type VerifyState = "form" | "sending" | "prompt" | "confirm" | "verified";

function ChannelStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const s = useStore();
  const existing = s.channels[0];
  const [kind, setKind] = useState<"till" | "paybill">(existing?.kind ?? "till");
  const [shortcode, setShortcode] = useState(existing?.shortcode ?? "");
  const [account, setAccount] = useState(existing?.accountNumber ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? (s.business?.name ?? "").toUpperCase());
  const [vs, setVs] = useState<VerifyState>(existing?.status === "verified" ? "verified" : "form");
  const [stage, setStage] = useState<PromptStage>("idle");
  const [error, setError] = useState("");
  const [channelId, setChannelId] = useState(existing?.id ?? "");
  const phone = s.account?.phone ?? "";

  const codeValid = /^\d{5,7}$/.test(shortcode);

  function send() {
    if (!codeValid) {
      setError(kind === "till" ? "A till number is 5 to 7 digits." : "A paybill number is 5 to 7 digits.");
      return;
    }
    if (!displayName.trim()) {
      setError("Enter the name customers see on the prompt.");
      return;
    }
    setError("");
    const id = addChannel({
      kind,
      shortcode,
      accountNumber: kind === "paybill" ? account.trim() || undefined : undefined,
      label: kind === "till" ? `Till ${shortcode}` : `Paybill ${shortcode}`,
      displayName: displayName.trim().toUpperCase(),
    });
    setChannelId(id);
    setVs("sending");
    setStage("idle");
    setTimeout(() => {
      setVs("prompt");
      setStage("prompt");
    }, 1400);
    setTimeout(() => setVs("confirm"), 3200);
  }

  return (
    <div className="onb-card wide">
      <div>
        <h1>Where should customer payments land?</h1>
        <p className="muted">
          Add the Till or Paybill you already use. STK Push payments settle straight into it, and SwiftPal never holds the
          money.
        </p>
      </div>

      <div className="onb-split">
        <div className="stack" style={{ gap: 18, alignContent: "start" }}>
          <div className="segmented" role="group" aria-label="Channel type" style={{ justifySelf: "start" }}>
            <button type="button" aria-pressed={kind === "till"} onClick={() => setKind("till")} disabled={vs !== "form"}>
              Till · Buy Goods
            </button>
            <button type="button" aria-pressed={kind === "paybill"} onClick={() => setKind("paybill")} disabled={vs !== "form"}>
              Paybill
            </button>
          </div>

          <div className="field">
            <label className="label" htmlFor="sc">{kind === "till" ? "Till number" : "Paybill number"}</label>
            <input id="sc" className="input mono" inputMode="numeric" placeholder={kind === "till" ? "5521093" : "4061217"} value={shortcode} disabled={vs !== "form"} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </div>

          {kind === "paybill" && (
            <div className="field">
              <label className="label" htmlFor="acc">Default account number <span className="dim">(optional)</span></label>
              <input id="acc" className="input mono" placeholder="Leave blank to use each payment's reference" value={account} disabled={vs !== "form"} onChange={(e) => setAccount(e.target.value.slice(0, 12))} />
              <span className="hint">When blank, the <code className="inline-code">reference</code> you send becomes the account number.</span>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="dn">Name on your M-Pesa statement</label>
            <input id="dn" className="input" value={displayName} disabled={vs !== "form"} onChange={(e) => setDisplayName(e.target.value)} />
            <span className="hint">Use the name Safaricom shows for this {kind}. We check it against the verification prompt.</span>
          </div>

          {error && <div className="form-error">{error}</div>}

          {vs === "form" && (
            <div className="callout">
              <Icon name="phone" size={16} />
              <span>
                We&apos;ll send a <b>KES 1</b> prompt to <b className="mono">{maskPhone(phone)}</b> that pays into this {kind}. Approve
                it and the shilling lands in your own account. That proves the {kind} is real and that it&apos;s yours.
              </span>
            </div>
          )}

          {vs === "sending" && (
            <div className="callout info">
              <span className="spinner" style={{ marginTop: 2 }} />
              <span>Sending the KES 1 prompt to {maskPhone(phone)}…</span>
            </div>
          )}

          {vs === "prompt" && (
            <div className="callout info">
              <Icon name="phone" size={16} />
              <span>Check your phone. The prompt should say <b>Pay Ksh1.00 to {displayName.toUpperCase()}</b>.</span>
            </div>
          )}

          {vs === "confirm" && (
            <div className="panel panel-body stack" style={{ gap: 12 }}>
              <b>Did the prompt show “{displayName.toUpperCase()}”?</b>
              <p className="muted" style={{ fontSize: 13.5 }}>
                If the name is different, that {kind} isn&apos;t registered to your business. Check the number and try again.
              </p>
              <div className="row wrap">
                <button
                  className="btn btn-pine"
                  onClick={() => {
                    verifyChannel(channelId);
                    setStage("done");
                    setVs("verified");
                  }}
                >
                  <Icon name="check" size={15} /> Yes, that&apos;s my business
                </button>
                <button
                  className="btn btn-line"
                  onClick={() => {
                    setVs("form");
                    setStage("idle");
                  }}
                >
                  No, edit details
                </button>
              </div>
            </div>
          )}

          {vs === "verified" && (
            <div className="callout pine">
              <Icon name="check" size={16} />
              <span>
                <b>{kind === "till" ? "Till" : "Paybill"} {shortcode} is verified.</b> Live STK Push is on, and KES {STARTER_CREDIT}{" "}
                starter credit has been added to your fee balance.
              </span>
            </div>
          )}
        </div>

        <div className="onb-phone">
          <PhonePrompt
            stage={stage}
            amount="Ksh1.00"
            merchant={(displayName || "YOUR BUSINESS").toUpperCase()}
            account={kind === "paybill" ? account || "SWIFTPAL" : undefined}
            pinDigits={0}
            receipt="TJG1V3RF7Y"
          />
          <span className="hint" style={{ textAlign: "center" }}>
            {stage === "idle" ? "Preview of what you'll see" : stage === "done" ? "Your confirmation SMS" : "Waiting for your PIN"}
          </span>
        </div>
      </div>

      <div className="onb-actions">
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <div className="row">
          {vs !== "verified" && (
            <button className="btn btn-ghost" onClick={onNext}>
              Skip — stay in sandbox
            </button>
          )}
          {vs === "form" && (
            <button className="btn btn-ink btn-lg" onClick={send}>
              Send KES 1 prompt
            </button>
          )}
          {vs === "verified" && (
            <button className="btn btn-ink btn-lg" onClick={onNext}>
              Continue <Icon name="arrowRight" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KeysStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const s = useStore();
  const key = s.keys.find((k) => k.mode === "test");
  const [show, setShow] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const payment = s.payments.find((p) => p.id === paymentId);
  const shownKey = key ? (show ? key.secret : key.secret.slice(0, 12) + "•".repeat(8) + key.secret.slice(-4)) : undefined;
  const snippets = useMemo(() => stkSnippets(shownKey, "254700000000", 100), [shownKey]);

  return (
    <div className="onb-card wide">
      <div>
        <h1>Your sandbox is ready</h1>
        <p className="muted">
          This test key sends simulated prompts and real webhooks. You can create more keys, and your live key, under
          Developers.
        </p>
      </div>

      {key && (
        <div className="keybox">
          <div className="keybox-head">
            <span className="badge warn">Test mode</span>
            <span className="muted" style={{ fontSize: 13 }}>Secret key</span>
          </div>
          <div className="keybox-row">
            <code className="mono">{show ? key.secret : key.secret.slice(0, 12) + "•".repeat(20) + key.secret.slice(-4)}</code>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-line btn-sm" onClick={() => setShow(!show)}>
                <Icon name={show ? "eyeOff" : "eye"} size={14} /> {show ? "Hide" : "Reveal"}
              </button>
              <span className="keybox-copy"><CopyButton text={key.secret} /></span>
            </div>
          </div>
        </div>
      )}

      <CodeBlock tabs={snippets} />

      <div className="panel panel-body spread wrap" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <b>Try it without writing code</b>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Sends KES 100 to sandbox number <span className="mono">254700000000</span>, which always pays.
          </span>
        </div>
        {!payment ? (
          <button
            className="btn btn-pine"
            onClick={() => {
              const r = simulateStk({ phone: "254700000000", amount: 100, reference: "FIRST-TEST" });
              if (r.ok) setPaymentId(r.payment.id);
            }}
          >
            <Icon name="play" size={14} /> Send test payment
          </button>
        ) : payment.status === "pending" ? (
          <span className="badge info"><span className="spinner" style={{ width: 10, height: 10 }} /> Waiting for PIN · {payment.id.slice(0, 14)}</span>
        ) : (
          <span className="badge ok">Paid · receipt {payment.receipt}</span>
        )}
      </div>

      <div className="onb-actions">
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <button className="btn btn-ink btn-lg" onClick={onDone}>
          Open dashboard <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </div>
  );
}
