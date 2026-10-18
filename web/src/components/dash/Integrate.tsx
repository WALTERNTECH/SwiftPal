"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { AI_PROMPT, payoutSnippets, stkSnippets } from "@/lib/snippets";

/** Copy-paste code for people who write it, and a full brief for people who prompt an assistant. */
export function Integrate() {
  const [what, setWhat] = useState<"collect" | "payout">("collect");
  const [copied, setCopied] = useState(false);
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
            <b>Building with an AI assistant?</b>
            <span className="muted">Paste this into Cursor, Claude Code or Copilot.</span>
          </div>
          <button
            className="btn btn-pine btn-sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(AI_PROMPT);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy prompt"}
          </button>
        </div>
      </div>
    </section>
  );
}
