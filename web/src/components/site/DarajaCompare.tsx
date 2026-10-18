"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useInView } from "@/components/motion";
import { TypedCode } from "@/components/TypedCode";
import { SITE } from "@/lib/site";

const DARAJA = [
  ["Register on the Daraja portal", "account"],
  ["Create an app, request M-Pesa Express", "app"],
  ["Apply for go-live, wait for Safaricom", "review"],
  ["Receive shortcode, passkey, initiator", "credentials"],
  ["Fetch an OAuth token every hour", "oauth"],
  ["Base64(shortcode + passkey + timestamp)", "password"],
  ["Host and register a callback URL", "callbacks"],
  ["Parse CallbackMetadata.Item[] by index", "parsing"],
];

const SWIFTPAL = [
  ["Sign up and verify", "ID and a selfie, once"],
  ["POST /v1/stk-push", "prompt on the phone in ~2s"],
  ["Receive a signed webhook", "same shape for every event"],
];

export function DarajaCompare() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const [struck, setStruck] = useState(0);
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const t: ReturnType<typeof setTimeout>[] = [];
    DARAJA.forEach((_, i) => t.push(setTimeout(() => setStruck(i + 1), 350 + i * 260)));
    const after = 350 + DARAJA.length * 260 + 200;
    SWIFTPAL.forEach((_, i) => t.push(setTimeout(() => setChecked(i + 1), after + i * 320)));
    return () => t.forEach(clearTimeout);
  }, [inView]);

  return (
    <div className="cmp" ref={ref}>
      <div className="cmp-col cmp-old">
        <div className="cmp-head">
          <span className="eyebrow">Daraja, directly</span>
          <span className="cmp-count num">{DARAJA.length - struck} steps left</span>
        </div>
        <ol>
          {DARAJA.map(([t, tag], i) => (
            <li key={t} className={i < struck ? "x" : ""}>
              <span className="cmp-n num">{String(i + 1).padStart(2, "0")}</span>
              <span className="cmp-t">
                <span>{t}</span>
              </span>
              <span className="tag">{tag}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="cmp-col cmp-new">
        <div className="cmp-head">
          <span className="eyebrow">With SwiftPal</span>
          <span className="cmp-count num on">{checked}/{SWIFTPAL.length}</span>
        </div>
        <ol>
          {SWIFTPAL.map(([t, d], i) => (
            <li key={t} className={i < checked ? "ok" : ""}>
              <span className="cmp-tick">
                <Icon name="check" size={12} strokeWidth={2.4} />
              </span>
              <div>
                <b className={i === 1 ? "mono" : ""}>{t}</b>
                <span>{d}</span>
              </div>
            </li>
          ))}
        </ol>
        <TypedCode
          className="cmp-code"
          title="terminal"
          cps={90}
          tabs={[
            {
              label: "terminal",
              lang: "bash",
              code: `curl ${SITE.apiBase}/stk-push \\
  -H "Authorization: Bearer $SWIFTPAL_KEY" \\
  -d '{"phone":"0712345678","amount":1250}'`,
            },
          ]}
        />
      </div>
    </div>
  );
}
