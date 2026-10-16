import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { SITE } from "@/lib/site";

export function AuthShell({ children, side, topRight }: { children: ReactNode; side: ReactNode; topRight?: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <div className="spread">
          <Logo />
          {topRight}
        </div>
        <div className="auth-form-wrap">{children}</div>
        <div className="auth-foot">
          <span>© 2026 SwiftPal</span>
          <span>
            Need help? <a className="link" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
          </span>
        </div>
      </div>
      <aside className="auth-side">{side}</aside>
    </div>
  );
}

export function NextSteps() {
  const items = [
    ["Verify your email", "A 6-digit code, so we know where to send receipts and alerts."],
    ["Tell us about your business", "Four quick questions. No documents needed yet."],
    ["Add your Till or Paybill", "We confirm it with a KES 1 prompt to your own phone."],
    ["Copy your keys", "Sandbox keys work immediately, with test prompts and real webhooks."],
  ];
  return (
    <>
      <div>
        <div className="eyebrow" style={{ color: "#6fbf9b" }}>
          About three minutes
        </div>
        <h2 style={{ marginTop: 12 }}>What happens after you sign up</h2>
      </div>
      <ol className="auth-list">
        {items.map(([t, d], i) => (
          <li key={t}>
            <span className="n">0{i + 1}</span>
            <div>
              <b>{t}</b>
              <span>{d}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: 13 }}>
        Already integrated with Daraja? Read the{" "}
        <Link href="/docs/quickstart" style={{ color: "#c9ecd9", textDecoration: "underline" }}>
          quickstart
        </Link>
        . Most teams switch with a single request change.
      </p>
    </>
  );
}
