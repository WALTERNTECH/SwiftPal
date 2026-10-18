import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { SITE } from "@/lib/site";

const COLS = [
  {
    title: "Products",
    links: [
      { href: "/docs/stk-push", label: "STK Push" },
      { href: "/docs/payouts", label: "B2C payouts" },
      { href: "/docs/payouts", label: "Bulk disbursements" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/errors", label: "Error codes" },
      { href: "/docs/faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      ...(SITE.supportEmail ? [{ href: `mailto:${SITE.supportEmail}`, label: "Support" }] : []),
      ...(SITE.salesEmail ? [{ href: `mailto:${SITE.salesEmail}`, label: "Sales" }] : []),
      { href: "/login", label: "Sign in" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>M-Pesa STK Push and B2C payouts through one API.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title} className="footer-col">
            <div className="eyebrow">{c.title}</div>
            {c.links.map((l) => (
              <Link key={l.label} href={l.href}>
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-word" aria-hidden>
        swiftpal
      </div>
      <div className="footer-base">
        <ThemeSwitch />
        <span>© 2026 SwiftPal. All rights reserved.</span>
      </div>
    </footer>
  );
}
