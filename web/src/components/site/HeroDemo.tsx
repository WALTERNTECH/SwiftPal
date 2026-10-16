"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useInView } from "@/components/motion";

type Flow = "collect" | "payout";
type Line = { dir: "out" | "in" | "evt" | "hook"; text: string; meta: string };

const LINES: Record<Flow, Line[]> = {
  collect: [
    { dir: "out", text: "POST /v1/stk-push", meta: '{ "amount": 1250 }' },
    { dir: "in", text: "201 pending", meta: "pay_01JC8Q2V · 184 ms" },
    { dir: "evt", text: "payment.succeeded", meta: "TJG4K2XQ8P" },
    { dir: "hook", text: "POST zuri.co.ke/webhooks", meta: "200 · signed · 39 ms" },
  ],
  payout: [
    { dir: "out", text: "POST /v1/payouts", meta: '{ "amount": 3500 }' },
    { dir: "in", text: "201 processing", meta: "po_01JC9B7K · 162 ms" },
    { dir: "evt", text: "payout.succeeded", meta: "TJK7H2L9QA" },
    { dir: "hook", text: "POST zuri.co.ke/webhooks", meta: "200 · signed · 41 ms" },
  ],
};

const PHONE_DIGITS = "0712345678";
const AMOUNT_DIGITS = "3500";

const fmtPhone = (d: string) => [d.slice(0, 4), d.slice(4, 7), d.slice(7)].filter(Boolean).join(" ");
const fmtAmount = (d: string) => (d ? Number(d).toLocaleString("en-KE") : "");

export function HeroDemo() {
  const [wrap, inView] = useInView<HTMLDivElement>({ margin: "0px" });
  const [flow, setFlow] = useState<Flow>("collect");
  const [run, setRun] = useState(0);

  const [typed, setTyped] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pin, setPin] = useState(0);
  const [sms, setSms] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const reset = () => {
      setTyped(0);
      setPressed(false);
      setBusy(false);
      setSheet(false);
      setPin(0);
      setSms(false);
      setDone(false);
      setLines(0);
    };
    clear();
    reset();
    if (!inView) return clear;

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    if (flow === "collect") {
      for (let i = 1; i <= PHONE_DIGITS.length; i++) at(300 + i * 85, () => setTyped(i));
      at(1450, () => setPressed(true));
      at(1600, () => { setPressed(false); setBusy(true); setLines(1); });
      at(2050, () => setLines(2));
      at(2300, () => setSheet(true));
      [2950, 3200, 3450, 3700].forEach((ms, i) => at(ms, () => setPin(i + 1)));
      at(4050, () => setSheet(false));
      at(5100, () => { setSms(true); setLines(3); });
      at(5500, () => setLines(4));
      at(6000, () => setDone(true));
      at(7600, () => setSms(false));
      at(10200, () => setRun((r) => r + 1));
    } else {
      for (let i = 1; i <= AMOUNT_DIGITS.length; i++) at(300 + i * 120, () => setTyped(i));
      at(1200, () => setPressed(true));
      at(1350, () => { setPressed(false); setBusy(true); setLines(1); });
      at(1750, () => setLines(2));
      at(3400, () => { setSms(true); setLines(3); });
      at(3800, () => setLines(4));
      at(4300, () => setDone(true));
      at(6000, () => setSms(false));
      at(8600, () => setRun((r) => r + 1));
    }
    return clear;
  }, [inView, flow, run]);

  const collect = flow === "collect";

  return (
    <div className="hd" ref={wrap}>
      <div className="hd-bar">
        <div className="segmented" role="group" aria-label="Flow">
          <button aria-pressed={collect} onClick={() => setFlow("collect")}>
            <Icon name="collect" size={13} /> STK Push
          </button>
          <button aria-pressed={!collect} onClick={() => setFlow("payout")}>
            <Icon name="payout" size={13} /> B2C payout
          </button>
        </div>
        <button className="hd-replay" onClick={() => setRun((r) => r + 1)} aria-label="Replay">
          <Icon name="refresh" size={13} /> Replay
        </button>
      </div>

      <div className="hd-stage">
        <div className="hd-glow" aria-hidden />

        <div className="hd-phone" aria-label={collect ? "Customer paying with M-Pesa" : "Seller withdrawing to M-Pesa"}>
          <div className="hd-island" />
          <div className="hd-status">
            <span>9:41</span>
            <span className="hd-sig">
              <i /><i /><i /><i />
              <b />
            </span>
          </div>

          <div className="hd-screen">
            <div className={`hd-track ${done ? "shift" : ""}`}>
              {/* screen 1 */}
              <section className="hd-app">
                <div className="hd-appbar">
                  <Icon name="arrowLeft" size={14} />
                  <b>Zuri Market</b>
                  <span className="hd-avatar">ZM</span>
                </div>
                {collect ? (
                  <>
                    <h4>Checkout</h4>
                    <div className="hd-items">
                      <div><span>Kitenge tote ×1</span><span>850</span></div>
                      <div><span>Delivery · Westlands</span><span>400</span></div>
                      <div className="tot"><span>Total</span><span>KES 1,250</span></div>
                    </div>
                    <label className="hd-label">M-Pesa number</label>
                    <div className={`hd-input ${typed > 0 && typed < PHONE_DIGITS.length ? "focus" : ""}`}>
                      <span>{fmtPhone(PHONE_DIGITS.slice(0, typed)) || <em>07XX XXX XXX</em>}</span>
                      {typed > 0 && typed < PHONE_DIGITS.length && <i className="hd-caret" />}
                    </div>
                  </>
                ) : (
                  <>
                    <h4>Withdraw earnings</h4>
                    <div className="hd-balance">
                      <span>Available</span>
                      <b>KES 4,820.00</b>
                    </div>
                    <label className="hd-label">Amount</label>
                    <div className={`hd-input ${typed > 0 && typed < AMOUNT_DIGITS.length ? "focus" : ""}`}>
                      <span>{typed ? `KES ${fmtAmount(AMOUNT_DIGITS.slice(0, typed))}` : <em>KES 0</em>}</span>
                      {typed > 0 && typed < AMOUNT_DIGITS.length && <i className="hd-caret" />}
                    </div>
                    <div className="hd-to">
                      To M-Pesa <b>0712 ••• 678</b>
                    </div>
                  </>
                )}
                <button className={`hd-pay ${pressed ? "pressed" : ""} ${busy ? "busy" : ""}`} tabIndex={-1}>
                  {busy ? (
                    <>
                      <span className="spinner" /> {collect ? (sheet ? "Check your phone" : "Waiting for M-Pesa") : "Sending to M-Pesa"}
                    </>
                  ) : collect ? (
                    "Pay KES 1,250 with M-Pesa"
                  ) : (
                    "Withdraw KES 3,500"
                  )}
                  {pressed && <span className="hd-ripple" />}
                </button>
              </section>

              {/* screen 2 */}
              <section className="hd-app hd-success">
                <svg className="hd-check" viewBox="0 0 52 52" aria-hidden>
                  <circle cx="26" cy="26" r="23" pathLength={1} />
                  <path d="M15 27l7 7 15-16" pathLength={1} />
                </svg>
                <h4>{collect ? "Payment received" : "Withdrawal sent"}</h4>
                <div className="hd-amt">{collect ? "KES 1,250.00" : "KES 3,500.00"}</div>
                <div className="hd-rows">
                  <div><span>M-Pesa receipt</span><b>{collect ? "TJG4K2XQ8P" : "TJK7H2L9QA"}</b></div>
                  <div><span>{collect ? "Order" : "Arrived in"}</span><b>{collect ? "#8841 · Paid" : "6 seconds"}</b></div>
                </div>
                <div className="hd-ghost-btn">{collect ? "Track order" : "Done"}</div>
              </section>
            </div>

            <div className={`hd-sms ${sms ? "on" : ""}`}>
              <div className="hd-sms-head">
                <span className="hd-sms-icon">M</span>
                <b>MPESA</b>
                <span>now</span>
              </div>
              <p>
                {collect ? (
                  <><b>TJG4K2XQ8P</b> Confirmed. Ksh1,250.00 paid to ZURI MARKET on 16/10/26 at 9:41 AM.</>
                ) : (
                  <><b>TJK7H2L9QA</b> Confirmed. You have received Ksh3,500.00 from ZURI MARKET on 16/10/26 at 9:41 AM.</>
                )}
              </p>
            </div>

            <div className={`hd-scrim ${sheet ? "on" : ""}`} />
            <div className={`hd-sheet ${sheet ? "on" : ""}`}>
              <div className="hd-sheet-title">M-PESA</div>
              <p>
                Pay <b>Ksh1,250.00</b> to <b>ZURI MARKET</b>. Enter M-PESA PIN:
              </p>
              <div className="hd-pin">
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className={i < pin ? "on" : ""} />
                ))}
              </div>
              <div className="hd-sheet-actions">
                <span>Cancel</span>
                <span className={pin >= 4 ? "on" : ""}>OK</span>
              </div>
            </div>
          </div>
          <div className="hd-homebar" />
        </div>

        <div className="hd-term" aria-live="polite">
          <div className="hd-term-head">
            <span className="code-dots" aria-hidden><i /><i /><i /></span>
            <span>api.swiftpal.co.ke</span>
            <span className={`hd-live ${lines > 0 && lines < 4 ? "on" : ""}`}>live</span>
          </div>
          <div className="hd-term-body">
            {LINES[flow].slice(0, lines).map((l, i) => (
              <div key={`${flow}-${run}-${i}`} className={`hd-line ${l.dir}`}>
                <span className="d">{l.dir === "in" ? "←" : l.dir === "evt" ? "◆" : "→"}</span>
                <span className="x">{l.text}</span>
                <span className="m">{l.meta}</span>
              </div>
            ))}
            {lines === 0 && <div className="hd-line idle"><span className="type-caret" /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
