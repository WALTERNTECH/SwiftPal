"use client";

import { useState } from "react";

export type Lang = "bash" | "js" | "ts" | "json" | "python" | "php" | "text";
export type CodeTab = { label: string; lang: Lang; code: string };

const KEYWORDS =
  "const|let|var|await|async|import|from|return|if|else|def|new|function|export|require|echo|print|for|in|try|catch|throw|use|class|public|private|with|as|null|true|false|None|True|False";

export function tokenize(code: string, lang: Lang): { t: string; c?: string }[] {
  if (lang === "text") return [{ t: code }];
  const hashComments = lang === "bash" || lang === "python";
  const re = new RegExp(
    [
      hashComments ? "((?<![\\w&$])#[^\\n]*)" : "((?<![:\\w])\\/\\/[^\\n]*)",
      '("(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:))',
      "(\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`[^`]*`)",
      "(\\b\\d+(?:\\.\\d+)?\\b)",
      `(\\b(?:${KEYWORDS})\\b)`,
    ].join("|"),
    "g",
  );
  const out: { t: string; c?: string }[] = [];
  let last = 0;
  for (const m of code.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: code.slice(last, i) });
    const cls = m[1] ? "c" : m[2] ? "k" : m[3] ? "s" : m[4] ? "n" : "w";
    out.push({ t: m[0], c: cls });
    last = i + m[0].length;
  }
  if (last < code.length) out.push({ t: code.slice(last) });
  return out;
}

export function Highlight({ code, lang }: { code: string; lang: Lang }) {
  return (
    <>
      {tokenize(code, lang).map((tok, i) =>
        tok.c ? (
          <span key={i} className={tok.c}>
            {tok.t}
          </span>
        ) : (
          tok.t
        ),
      )}
    </>
  );
}

/** Highlighted code cut off after `upto` characters, for the typing effect. */
export function HighlightUpTo({ tokens, upto }: { tokens: { t: string; c?: string }[]; upto: number }) {
  const out: React.ReactNode[] = [];
  let left = upto;
  for (let i = 0; i < tokens.length && left > 0; i++) {
    const tok = tokens[i];
    const text = tok.t.length <= left ? tok.t : tok.t.slice(0, left);
    left -= text.length;
    out.push(
      tok.c ? (
        <span key={i} className={tok.c}>
          {text}
        </span>
      ) : (
        text
      ),
    );
  }
  return <>{out}</>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="code-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked; nothing to do */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({
  tabs,
  title,
  className,
  maxHeight,
}: {
  tabs: CodeTab[];
  title?: string;
  className?: string;
  maxHeight?: number;
}) {
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0];
  return (
    <div className={`code ${className ?? ""}`}>
      <div className="code-head">
        {tabs.length > 1 ? (
          <div className="code-tabs" role="tablist">
            {tabs.map((t, i) => (
              <button
                key={t.label}
                role="tab"
                aria-selected={i === active}
                className="code-tab"
                onClick={() => setActive(i)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="code-title">{title ?? tab.label}</span>
        )}
        <CopyButton text={tab.code} />
      </div>
      <pre style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <code>
          <Highlight code={tab.code} lang={tab.lang} />
        </code>
      </pre>
    </div>
  );
}
