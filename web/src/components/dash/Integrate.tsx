"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { SITE } from "@/lib/site";
import { AI_PROMPT, payoutSnippets, stkSnippets } from "@/lib/snippets";

const INSTRUCTION = `Add M-Pesa payments with SwiftPal: ${SITE.url}/llms.txt`;

/** Copy-paste code for people who write it, and a full brief for people who prompt an assistant. */
export function Integrate() {
  const [what, setWhat] = useState<"collect" | "payout">("collect");
  const [copied, setCopied] = useState<"line" | "full" | null>(null);
  const copy = async (text: string, which: "line" | "full") => {
    await navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };
  const tabs = useMemo(() => (what === "collect" ? stkSnippets() : payoutSnippets()), [what]);

  return (
    <section className="panel rise">
      <div className="panel-head">
        <div className="segmented" role="group" aria-label="Example">
          <button aria-pressed={what === "collect"} onClick={() => setWhat("collect")}>Collect a payment</button>
          <button aria-pressed={what === "payout"} onClick={() => setWhat("payout")}>Send a payout</button>
        </div>
        <Link href="/docs" className="link" style={{ fontSize: 13 }}>
          Full API reference
        </Link>
      </div>
      <div className="panel-body stack" style={{ gap: 16 }}>
        <CodeBlock key={what} tabs={tabs} />
        <div className="ai-prompt">
          <span className="ai-prompt-ic">
            <Icon name="bolt" size={16} />
          </span>
          <div className="grow">
            <b>Let your AI assistant set it up</b>
            <span className="muted">
              Tell Claude, Cursor or Copilot: <span className="mono ai-line">{INSTRUCTION}</span>. It connects to your account and you approve it here.
            </span>
          </div>
          <div className="ai-actions">
            <button className="btn btn-pine btn-sm" onClick={() => copy(INSTRUCTION, "line")}>
              <Icon name={copied === "line" ? "check" : "copy"} size={14} /> {copied === "line" ? "Copied" : "Copy"}
            </button>
            <button className="text-btn quiet" onClick={() => copy(AI_PROMPT, "full")}>
              {copied === "full" ? "Full prompt copied" : "Copy full prompt"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
