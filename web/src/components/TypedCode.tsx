"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton, Highlight, HighlightUpTo, tokenize, type CodeTab } from "./CodeBlock";
import { Icon } from "./Icon";
import { useInView } from "./motion";

/**
 * A code block that types itself out when it scrolls into view, then shows
 * the response underneath. Switching tabs types the new snippet. Copy always
 * copies the whole snippet, typed or not.
 */
export function TypedCode({
  tabs,
  title,
  response,
  cps = 140,
  className,
  minHeight,
}: {
  tabs: CodeTab[];
  title?: string;
  response?: { label: string; code: string };
  /** characters per second */
  cps?: number;
  className?: string;
  minHeight?: number;
}) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const [active, setActive] = useState(0);
  const [n, setN] = useState(0);
  const [run, setRun] = useState(0);
  const tab = tabs[active] ?? tabs[0];
  const tokens = useMemo(() => tokenize(tab.code, tab.lang), [tab]);
  const total = tab.code.length;
  const done = n >= total;
  const raf = useRef(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(total);
      return;
    }
    setN(0);
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const next = Math.min(total, Math.floor(((t - start) / 1000) * cps));
      setN(next);
      if (next < total) raf.current = requestAnimationFrame(step);
    };
    const delay = setTimeout(() => (raf.current = requestAnimationFrame(step)), 250);
    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf.current);
    };
  }, [inView, active, run, total, cps]);

  return (
    <div className={`code typed ${className ?? ""}`} ref={ref}>
      <div className="code-head">
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          <span className="code-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {tabs.length > 1 ? (
            <div className="code-tabs" role="tablist">
              {tabs.map((t, i) => (
                <button key={t.label} role="tab" aria-selected={i === active} className="code-tab" onClick={() => setActive(i)}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="code-title">{title ?? tab.label}</span>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="code-copy" onClick={() => setRun((r) => r + 1)} aria-label="Replay typing" title="Replay">
            <Icon name="refresh" size={12} />
          </button>
          <CopyButton text={tab.code} />
        </div>
      </div>
      <pre style={minHeight ? { minHeight } : undefined}>
        <code>
          <HighlightUpTo tokens={tokens} upto={n} />
          {!done && <span className="type-caret" />}
        </code>
      </pre>
      {response && (
        <div className={`typed-response ${done ? "on" : ""}`} aria-hidden={!done}>
          <div className="typed-response-head">
            <span className="dot" /> {response.label}
          </div>
          <pre>
            <code>
              <Highlight code={response.code} lang="json" />
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
