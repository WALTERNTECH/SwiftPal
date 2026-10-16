"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Highlight } from "@/components/CodeBlock";
import { PhonePrompt, type PromptStage } from "@/components/PhonePrompt";
import { Icon } from "@/components/Icon";

const REQUEST = `POST /v1/stk-push
Authorization: Bearer sp_live_••••••••3f9a

{
  "phone": "254712345678",
  "amount": 1250,
  "reference": "ORDER-8841"
}`;

type Line = { at: string; dir: "out" | "in" | "evt"; text: string; meta?: string };

export function HeroDemo() {
  const [stage, setStage] = useState<PromptStage>("idle");
  const [pin, setPin] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const run = useCallback(() => {
    clear();
    setRunning(true);
    setStage("idle");
    setPin(0);
    setLines([]);
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const push = (l: Line) => setLines((prev) => [...prev, l]);

    at(150, () => push({ at: "09:41:07.012", dir: "out", text: "POST /v1/stk-push", meta: "amount=1250" }));
    at(560, () => {
      push({ at: "09:41:07.196", dir: "in", text: "201 Created", meta: "pay_01JC8Q2V · pending · 184 ms" });
      setStage("prompt");
    });
    [1500, 1760, 2020, 2280].forEach((ms, i) => at(ms, () => { setStage("pin"); setPin(i + 1); }));
    at(2750, () => setStage("processing"));
    at(4000, () => {
      setStage("done");
      push({ at: "09:41:19.448", dir: "evt", text: "payment.succeeded", meta: "receipt TJG4K2XQ8P" });
    });
    at(4450, () => {
      push({ at: "09:41:19.487", dir: "out", text: "→ shop.example/webhooks", meta: "200 OK · signed · 39 ms" });
      setRunning(false);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(run, 900);
    return () => {
      clearTimeout(t);
      clear();
    };
  }, [run]);

  return (
    <div className="hero-demo">
      <div className="code hero-code">
        <div className="code-head">
          <span className="code-title">request.http</span>
          <button className="code-copy run" onClick={run} disabled={running}>
            <Icon name={running ? "clock" : "play"} size={12} />
            {running ? "Running" : "Run again"}
          </button>
        </div>
        <pre>
          <code>
            <Highlight code={REQUEST} lang="json" />
          </code>
        </pre>
        <div className="hero-log" aria-live="polite">
          {lines.length === 0 && <div className="hero-log-empty">Waiting for request…</div>}
          {lines.map((l, i) => (
            <div key={i} className={`hero-log-line ${l.dir}`}>
              <span className="t">{l.at}</span>
              <span className="d">{l.dir === "in" ? "←" : l.dir === "evt" ? "◆" : "→"}</span>
              <span className="x">{l.text}</span>
              {l.meta && <span className="m">{l.meta}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="hero-phone">
        <PhonePrompt
          stage={stage}
          pinDigits={pin}
          amount="Ksh1,250.00"
          merchant="NJERI HOME STORES"
          account="ORDER-8841"
          receipt="TJG4K2XQ8P"
        />
        <div className="hero-phone-caption">
          <span className="dot" /> Settles to Till 5521093 — your till, not ours
        </div>
      </div>
    </div>
  );
}
