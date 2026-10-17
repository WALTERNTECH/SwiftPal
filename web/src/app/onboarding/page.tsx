"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CodeBlock, CopyButton } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { PhonePrompt, type PromptStage } from "@/components/PhonePrompt";
import { api, invalidate, useApi, useMe, usePaymentWatch, type ApiError, type ApiKey, type Channel, type Merchant, type Payment } from "@/lib/api";
import { maskPhone } from "@/lib/format";
import { STARTER_CREDIT } from "@/lib/pricing";
import { stkSnippets } from "@/lib/snippets";
import "./onboarding.css";

const STEPS = [
  { t: "Your business", d: "Who you are and what you're building" },
  { t: "Till or Paybill", d: "Verified with KES 1" },
  { t: "Your keys", d: "Send a first test payment" },
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
    else if (me && !me.user.email_verified_at) router.replace("/verify-email");
  }, [error, me, router]);

  if (!me) {
    return (
      <div className="onb" style={{ display: "grid", placeItems: "center" }}>
        {error && error.status !== 401 ? <p className="muted">{error.message}</p> : <span className="spinner" />}
      </div>
    );
  }

  return (
    <div className="onb">
      <header className="onb-top">
        <Logo href="/" />
        <span className="muted mono" style={{ fontSize: 12.5 }}>
          Step {step + 1} of {STEPS.length}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await finish().catch(() => {});
            router.push("/dashboard");
          }}
        >
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
          {step === 0 && <BusinessStep merchant={me.merchant} onNext={() => setStep(1)} />}
          {step === 1 && <ChannelStep phone={me.user.phone} businessName={me.merchant.name} existing={me.channels[0]} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
          {step === 2 && (
            <KeysStep
              onBack={() => setStep(1)}
              onDone={async () => {
                await finish().catch(() => {});
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
        <button className="btn btn-ink btn-lg" disabled={busy}>
          {busy ? <span className="spinner" /> : <>Continue <Icon name="arrowRight" size={15} /></>}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function ChannelStep({ phone, businessName, existing, onBack, onNext }: { phone: string; businessName: string; existing?: Channel; onBack: () => void; onNext: () => void }) {
  const [kind, setKind] = useState<"till" | "paybill">(existing?.kind ?? "till");
  const [shortcode, setShortcode] = useState(existing?.shortcode ?? "");
  const [account, setAccount] = useState(existing?.account_number ?? "");
  const [displayName, setDisplayName] = useState(existing?.display_name ?? businessName.toUpperCase());
  const [channel, setChannel] = useState<Channel | null>(existing ?? null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const payment = usePaymentWatch(paymentId);

  const verified = channel?.status === "verified";
  const vs = verified ? "verified" : sending ? "sending" : payment?.status === "pending" ? "prompt" : payment?.status === "succeeded" ? "confirm" : "form";
  const stage: PromptStage = vs === "prompt" ? "prompt" : vs === "confirm" || vs === "verified" ? "done" : "idle";
  const locked = vs !== "form";

  useEffect(() => {
    if (payment && ["failed", "cancelled", "expired"].includes(payment.status)) {
      setError(payment.failure_message ? `The prompt didn't go through: ${payment.failure_message}.` : "The prompt didn't go through. Try again.");
      setPaymentId(null);
    }
  }, [payment]);

  async function send() {
    if (!/^\d{5,7}$/.test(shortcode)) return setError(kind === "till" ? "A till number is 5 to 7 digits." : "A paybill number is 5 to 7 digits.");
    if (kind === "paybill" && !account.trim()) return setError("Enter the account number for this paybill.");
    if (!displayName.trim()) return setError("Enter the name customers see on the prompt.");
    setError("");
    setSending(true);
    try {
      let ch = channel;
      const changed = ch && (ch.shortcode !== shortcode || ch.kind !== kind || (ch.account_number ?? "") !== account.trim() || ch.display_name !== displayName.trim().toUpperCase());
      if (ch && changed) {
        await api(`/app/channels/${ch.id}`, { method: "DELETE" });
        ch = null;
      }
      if (!ch) {
        ch = await api<Channel>("/app/channels", {
          body: { kind, shortcode, account_number: kind === "paybill" ? account.trim() : undefined, display_name: displayName.trim() },
        });
        setChannel(ch);
      }
      const v = await api<{ channel: Channel; payment: Payment | null }>(`/app/channels/${ch.id}/verify`, { method: "POST" });
      setChannel(v.channel);
      if (v.payment) setPaymentId(v.payment.id);
      invalidate("/app/me");
    } catch (err) {
      setError((err as ApiError).message);
    }
    setSending(false);
  }

  async function confirm() {
    if (!channel) return;
    setConfirming(true);
    try {
      const r = await api<{ channel: Channel; live_key: string | null }>(`/app/channels/${channel.id}/confirm`, { method: "POST" });
      setChannel(r.channel);
      setLiveKey(r.live_key);
      invalidate("/app/me", "/app/keys", "/app/channels");
    } catch (err) {
      setError((err as ApiError).message);
    }
    setConfirming(false);
  }

  return (
    <div className="onb-card wide">
      <div>
        <h1>Add your Till or Paybill</h1>
        <p className="muted">The shortcode your STK Push requests route to. We confirm it with a KES 1 prompt.</p>
      </div>

      <div className="onb-split">
        <div className="stack" style={{ gap: 18, alignContent: "start" }}>
          <div className="segmented" role="group" aria-label="Channel type" style={{ justifySelf: "start" }}>
            <button type="button" aria-pressed={kind === "till"} onClick={() => setKind("till")} disabled={locked}>
              Till · Buy Goods
            </button>
            <button type="button" aria-pressed={kind === "paybill"} onClick={() => setKind("paybill")} disabled={locked}>
              Paybill
            </button>
          </div>

          <div className="field">
            <label className="label" htmlFor="sc">{kind === "till" ? "Till number" : "Paybill number"}</label>
            <input id="sc" className="input mono" inputMode="numeric" placeholder={kind === "till" ? "5521093" : "247247"} value={shortcode} disabled={locked} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </div>

          {kind === "paybill" && (
            <div className="field">
              <label className="label" htmlFor="acc">Account number</label>
              <input id="acc" className="input mono" value={account} disabled={locked} onChange={(e) => setAccount(e.target.value.slice(0, 20))} />
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="dn">Name on your M-Pesa statement</label>
            <input id="dn" className="input" value={displayName} disabled={locked} onChange={(e) => setDisplayName(e.target.value)} />
            <span className="hint">Use the name Safaricom shows for this {kind}. We check it against the verification prompt.</span>
          </div>

          {error && <div className="form-error">{error}</div>}

          {vs === "form" && (
            <div className="callout">
              <Icon name="phone" size={16} />
              <span>
                We&apos;ll send a <b>KES 1</b> prompt to <b className="mono">{maskPhone(phone)}</b> that pays into this {kind}. Approve it and
                the shilling lands in your own account.
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
              <span>
                Check your phone. The prompt should say <b>Pay Ksh1.00 to {displayName.toUpperCase()}</b>.
              </span>
            </div>
          )}

          {vs === "confirm" && (
            <div className="panel panel-body stack" style={{ gap: 12 }}>
              <b>Did the prompt show “{displayName.toUpperCase()}”?</b>
              <p className="muted" style={{ fontSize: 13.5 }}>
                If the name is different, that {kind} isn&apos;t registered to your business. Check the number and try again.
              </p>
              <div className="row wrap">
                <button className="btn btn-pine" onClick={confirm} disabled={confirming}>
                  {confirming ? <span className="spinner" /> : <Icon name="check" size={15} />} Yes, that&apos;s my business
                </button>
                <button className="btn btn-line" onClick={() => setPaymentId(null)}>
                  No, edit details
                </button>
              </div>
            </div>
          )}

          {vs === "verified" && (
            <div className="callout pine">
              <Icon name="check" size={16} />
              <span>
                <b>
                  {kind === "till" ? "Till" : "Paybill"} {shortcode} is verified.
                </b>{" "}
                Live STK Push is on{liveKey ? `, and KES ${STARTER_CREDIT} starter credit is in your fee balance` : ""}.
              </span>
            </div>
          )}

          {liveKey && (
            <div className="keybox">
              <div className="keybox-head">
                <span className="badge ok">Live</span>
                <span className="muted" style={{ fontSize: 13 }}>Your live secret key. It&apos;s shown once; store it now.</span>
              </div>
              <div className="keybox-row">
                <code className="mono">{liveKey}</code>
                <span className="keybox-copy">
                  <CopyButton text={liveKey} />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="onb-phone">
          <PhonePrompt
            stage={stage}
            amount="Ksh1.00"
            merchant={(displayName || "YOUR BUSINESS").toUpperCase()}
            account={kind === "paybill" ? account || "—" : undefined}
            pinDigits={0}
            receipt={payment?.mpesa_receipt ?? "—"}
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
  const { data: keys } = useApi<ApiKey[]>("/app/keys");
  const key = keys?.find((k) => k.mode === "test" && k.secret);
  const [show, setShow] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const payment = usePaymentWatch(paymentId);
  const secret = key?.secret ?? "";
  const shownKey = secret ? (show ? secret : secret.slice(0, 12) + "•".repeat(8) + secret.slice(-4)) : undefined;
  const snippets = useMemo(() => stkSnippets(shownKey, "254700000000", 100), [shownKey]);

  return (
    <div className="onb-card wide">
      <div>
        <h1>Your sandbox is ready</h1>
        <p className="muted">This test key sends simulated prompts and real webhooks. Create more keys under Developers.</p>
      </div>

      {key ? (
        <div className="keybox">
          <div className="keybox-head">
            <span className="badge warn">Test mode</span>
            <span className="muted" style={{ fontSize: 13 }}>Secret key</span>
          </div>
          <div className="keybox-row">
            <code className="mono">{show ? secret : secret.slice(0, 12) + "•".repeat(20) + secret.slice(-4)}</code>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-line btn-sm" onClick={() => setShow(!show)}>
                <Icon name={show ? "eyeOff" : "eye"} size={14} /> {show ? "Hide" : "Reveal"}
              </button>
              <span className="keybox-copy">
                <CopyButton text={secret} />
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="keybox">
          <div className="keybox-row">
            <span className="spinner" />
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
            onClick={async () => {
              setError("");
              try {
                const p = await api<Payment>("/app/payments", { body: { mode: "test", phone: "254700000000", amount: 100, reference: "FIRST-TEST" } });
                setPaymentId(p.id);
              } catch (err) {
                setError((err as ApiError).message);
              }
            }}
          >
            <Icon name="play" size={14} /> Send test payment
          </button>
        ) : payment.status === "pending" ? (
          <span className="badge info">
            <span className="spinner" style={{ width: 10, height: 10 }} /> Waiting for PIN · {payment.id.slice(0, 14)}
          </span>
        ) : (
          <span className={`badge ${payment.status === "succeeded" ? "ok" : "warn"}`}>
            {payment.status === "succeeded" ? `Paid · receipt ${payment.mpesa_receipt}` : payment.status}
          </span>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}

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
