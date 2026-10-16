import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SITE } from "@/lib/site";

const COLS = [
  {
    title: "Products",
    links: [
      { href: "/docs/stk-push", label: "STK Push" },
      { href: "/docs/payouts", label: "B2C payouts" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/sandbox", label: "Sandbox" },
      { href: "/docs/errors", label: "Error codes" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: `mailto:${SITE.supportEmail}`, label: "Support" },
      { href: `mailto:${SITE.salesEmail}`, label: "Sales" },
      { href: "/signup", label: "Create account" },
      { href: "/login", label: "Sign in" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p className="muted">M-Pesa STK Push and B2C payouts for developers. Built in Nairobi.</p>
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
        <div className="footer-base">
          <span>© 2026 SwiftPal. Nairobi, Kenya.</span>
          <span className="mono">M-Pesa is a trademark of Safaricom PLC. SwiftPal is not affiliated with Safaricom.</span>
        </div>
      </div>
    </footer>
  );
}
