"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WakeApi } from "@/components/auth/WakeApi";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { api, type ApiError } from "@/lib/api";
import { money, normalisePhone } from "@/lib/format";

type View = { title: string; description: string | null; amount: number | null; business: string; verified: boolean; open: boolean };
type Status = { status: "pending" | "succeeded" | "failed" | "cancelled" | "expired"; amount: number; mpesa_receipt: string | null; message: string | null };

/** The page a payment link opens: the customer enters their number and approves the M-Pesa prompt. */
export default function Pay() {
  const { slug } = useParams<{ slug: string }>();
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api<View>(`/pay/links/${encodeURIComponent(slug)}`)
      .then((v) => {
        setView(v);
        document.title = `Pay ${v.business} · ${v.title}`;
      })
      .catch((e: ApiError) => setMissing(e.message));
  }, [slug]);

  // Follow the prompt until M-Pesa answers.
  useEffect(() => {
    if (!payment) return;
    const poll = async () => {
      try {
        const s = await api<Status>(`/pay/status/${payment}`);
        setStatus(s);
        if (s.status !== "pending" && timer.current) clearInterval(timer.current);
      } catch {
        /* keep polling */
      }
    };
    poll();
    timer.current = setInterval(poll, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [payment]);

  const fixed = view?.amount ?? null;
  const amt = fixed ?? Math.floor(Number(amount) || 0);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const p = normalisePhone(phone);
    if (!p) return setError("Enter your M-Pesa number, e.g. 0712 345 678.");
    if (amt < 1 || amt > 250_000) return setError("Enter an amount between KES 1 and KES 250,000.");
    setBusy(true);
    setError("");
    setStatus(null);
    try {
      const r = await api<{ payment: string }>(`/pay/links/${encodeURIComponent(slug)}`, { body: { phone: p, amount: fixed === null ? amt : undefined } });
      setPayment(r.payment);
    } catch (err) {
      setError((err as ApiError).message);
    }
    setBusy(false);
  }

  const waiting = payment && (!status || status.status === "pending");
  const done = status?.status === "succeeded";
  const failed = status && status.status !== "pending" && !done;

  return (
    <div className="paypage">
      <div className="app-bg" aria-hidden />
      <WakeApi />
      <main className="pay-center">
        <div className="pay-card">
          {missing ? (
            <div className="pay-state">
              <span className="pay-ring neutral"><Icon name="link" size={22} /></span>
              <h1>Link not found</h1>
              <p className="muted">{missing} Check the link with the business that sent it.</p>
            </div>
          ) : !view ? (
            <div className="pay-state"><span className="spinner" /></div>
          ) : done ? (
            <div className="pay-state">
              <span className="pay-ring ok"><Icon name="check" size={24} /></span>
              <h1>Payment received</h1>
              <p className="muted">{money(status!.amount)} paid to {view.business}.</p>
              {status!.mpesa_receipt && (
                <div className="pay-receipt">
                  <span>M-Pesa receipt</span>
                  <b className="mono">{status!.mpesa_receipt}</b>
                </div>
              )}
              <p className="hint">You can close this page. M-Pesa has sent you a confirmation SMS.</p>
            </div>
          ) : waiting ? (
            <div className="pay-state">
              <span className="pay-ring"><span className="spinner" /></span>
              <h1>Check your phone</h1>
              <p className="muted">
                Enter your M-Pesa PIN to pay <b className="num">{money(amt)}</b> to {view.business}. The prompt stays open for about a minute.
              </p>
            </div>
          ) : (
            <>
              <div className="pay-merchant">
                <span className="pay-mono">{view.business.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div>
                  <b>{view.business}</b>
                  {view.verified && (
                    <span className="pay-verified"><Icon name="shield" size={12} /> Verified business</span>
                  )}
                </div>
              </div>
              <div className="pay-head">
                <h1>{view.title}</h1>
                {view.description && <p className="muted">{view.description}</p>}
              </div>
              {!view.open ? (
                <div className="callout warn">
                  <Icon name="info" size={16} />
                  <span>This link isn&apos;t taking payments right now. Contact {view.business}.</span>
                </div>
              ) : (
                <form className="stack" style={{ gap: 14 }} onSubmit={pay} noValidate>
                  {fixed !== null ? (
                    <div className="pay-amount">
                      <small>KES</small>
                      {fixed.toLocaleString("en-KE")}
                    </div>
                  ) : (
                    <div className="field">
                      <label className="label" htmlFor="amt">Amount</label>
                      <div className="input-group">
                        <span className="prefix">KES</span>
                        <input id="amt" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
                      </div>
                    </div>
                  )}
                  <div className="field">
                    <label className="label" htmlFor="ph">M-Pesa number</label>
                    <div className="input-group">
                      <span className="prefix">+254</span>
                      <input id="ph" className="input mono" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                  </div>
                  {failed && <div className="form-error">{status!.message ?? "The payment didn't go through."} Try again.</div>}
                  {error && <div className="form-error" role="alert">{error}</div>}
                  <button className="btn btn-pine btn-lg btn-block" disabled={busy}>
                    {busy ? <span className="spinner" /> : amt > 0 ? `Pay ${money(amt)} with M-Pesa` : "Pay with M-Pesa"}
                  </button>
                  <p className="hint" style={{ textAlign: "center" }}>You&apos;ll approve it on your phone with your M-Pesa PIN. Nobody asks for your PIN here.</p>
                </form>
              )}
            </>
          )}
        </div>
        <div className="pay-foot">
          <LogoMark size={16} /> Payments by SwiftPal
        </div>
      </main>
    </div>
  );
}
