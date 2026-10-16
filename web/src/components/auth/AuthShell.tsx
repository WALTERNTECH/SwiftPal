import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
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
          <ThemeSwitch />
          <span>
            Help: <a className="link" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
          </span>
        </div>
      </div>
      <aside className="auth-side">{side}</aside>
    </div>
  );
}

export function NextSteps() {
  const items = [
    ["Verify your email", "6-digit code."],
    ["Business details", "Four questions. No documents yet."],
    ["Till or Paybill", "Verified with a KES 1 prompt to your phone."],
    ["API keys", "Sandbox key works immediately."],
  ];
  return (
    <>
      <div>
        <div className="eyebrow">About three minutes</div>
        <h2 style={{ marginTop: 12 }}>Setup</h2>
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
        Moving from Daraja?{" "}
        <Link href="/docs/quickstart" style={{ color: "#6fe0ad", textDecoration: "underline", textUnderlineOffset: 3 }}>
          Quickstart
        </Link>
      </p>
    </>
  );
}
