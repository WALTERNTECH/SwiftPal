"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { resetPrototype, setMode, signOut, useHydrated, useStore } from "@/lib/store";
import { ToastHost } from "./ui";

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };

const NAV: { group?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Home", icon: "home", exact: true },
      { href: "/dashboard/payments", label: "Payments", icon: "collect" },
      { href: "/dashboard/payouts", label: "Payouts", icon: "payout" },
      { href: "/dashboard/wallet", label: "Wallet", icon: "wallet" },
      { href: "/dashboard/channels", label: "Channels", icon: "channel" },
    ],
  },
  {
    group: "Developers",
    items: [
      { href: "/dashboard/developers", label: "API keys", icon: "key", exact: true },
      { href: "/dashboard/developers/webhooks", label: "Webhooks", icon: "webhook" },
      { href: "/dashboard/developers/logs", label: "Request logs", icon: "logs" },
    ],
  },
  {
    items: [{ href: "/dashboard/settings", label: "Settings", icon: "settings" }],
  },
];

export function DashShell({ children }: { children: ReactNode }) {
  const s = useStore();
  const hydrated = useHydrated();
  const router = useRouter();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!s.signedIn || !s.account) router.replace("/login");
    else if (!s.account.emailVerified) router.replace("/verify-email");
  }, [hydrated, s.signedIn, s.account, router]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => setNavOpen(false), [path]);

  if (!hydrated || !s.signedIn || !s.account) {
    return <div className="dash-loading"><span className="spinner" /></div>;
  }

  const initials = `${s.account.firstName[0] ?? ""}${s.account.lastName[0] ?? ""}`.toUpperCase() || "SP";
  const test = s.mode === "test";
  const isActive = (n: NavItem) => (n.exact ? path === n.href : path === n.href || path.startsWith(n.href + "/"));

  return (
    <ToastHost>
      <div className={`dash ${test ? "is-test" : ""}`}>
        <aside className={`side ${navOpen ? "open" : ""}`}>
          <div className="side-brand">
            <LogoMark size={26} />
            <div className="grow">
              <b>{s.business?.name || "Your business"}</b>
              <span>{s.account.email}</span>
            </div>
          </div>
          <nav className="side-nav" aria-label="Dashboard">
            {NAV.map((g, i) => (
              <div key={i} className="side-group">
                {g.group && <div className="side-label">{g.group}</div>}
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} aria-current={isActive(n) ? "page" : undefined}>
                    <Icon name={n.icon} size={16} />
                    {n.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <Link href="/docs" className="side-doc">
              <Icon name="book" size={15} /> Documentation <Icon name="external" size={12} className="dim" />
            </Link>
            <div className="side-theme">
              <ThemeSwitch />
            </div>
            <div className="preview-note">
              <b>Preview build</b>
              <span>Data is simulated and stays in this browser.</span>
              <button
                className="link"
                onClick={() => {
                  if (confirm("Clear all preview data in this browser and start over?")) {
                    resetPrototype();
                    router.push("/");
                  }
                }}
              >
                Reset preview
              </button>
            </div>
          </div>
        </aside>
        {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} />}

        <div className="dash-main">
          {test && (
            <div className="test-strip">
              <span>Test mode</span> You&apos;re viewing sandbox data. Nothing here moves real money.
            </div>
          )}
          <header className="topbar">
            <button className="btn btn-ghost btn-sm topbar-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Icon name="menu" size={18} />
            </button>
            <div className="grow" />
            <label className="mode-toggle">
              <span className={test ? "on" : ""}>Test mode</span>
              <button
                role="switch"
                aria-checked={test}
                className="switch warn"
                onClick={() => setMode(test ? "live" : "test")}
                aria-label="Test mode"
              />
            </label>
            <div className="acct" ref={menuRef}>
              <button className="acct-btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Account menu">
                {initials}
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <b>
                      {s.account.firstName} {s.account.lastName}
                    </b>
                    <span>{s.account.email}</span>
                  </div>
                  <Link href="/dashboard/settings" role="menuitem" onClick={() => setMenu(false)}>
                    <Icon name="settings" size={15} /> Settings
                  </Link>
                  <Link href="/docs" role="menuitem" onClick={() => setMenu(false)}>
                    <Icon name="book" size={15} /> Docs
                  </Link>
                  <button
                    role="menuitem"
                    onClick={() => {
                      signOut();
                      router.push("/login");
                    }}
                  >
                    <Icon name="logout" size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </header>
          <main className="dash-content">{children}</main>
        </div>
      </div>
    </ToastHost>
  );
}
