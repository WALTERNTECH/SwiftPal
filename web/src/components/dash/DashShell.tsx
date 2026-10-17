"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { money, timeAgo } from "@/lib/format";
import { resetPrototype, setMode, signOut, useHydrated, useStore } from "@/lib/store";
import { ActionsProvider, useActions, type Action } from "./actions";
import { CommandPalette } from "./CommandPalette";
import { currentItem, isActive, NAV } from "./nav";
import { ToastHost } from "./ui";

export function DashShell({ children }: { children: ReactNode }) {
  const s = useStore();
  const hydrated = useHydrated();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (!s.signedIn || !s.account) router.replace("/login");
    else if (!s.account.emailVerified) router.replace("/verify-email");
  }, [hydrated, s.signedIn, s.account, router]);

  if (!hydrated || !s.signedIn || !s.account) {
    return (
      <div className="dash-loading">
        <LogoMark size={34} />
      </div>
    );
  }

  return (
    <ToastHost>
      <ActionsProvider>
        <Shell>{children}</Shell>
      </ActionsProvider>
    </ToastHost>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const s = useStore();
  const path = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const test = s.mode === "test";

  useEffect(() => setNavOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdk((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`dash ${test ? "is-test" : ""}`}>
      <MotionBackground />
      <Sidebar open={navOpen} />
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} />}
      <div className="dash-main">
        {test && (
          <div className="test-strip">
            <span>Test mode</span> Sandbox data
          </div>
        )}
        <Topbar onMenu={() => setNavOpen(true)} onSearch={() => setCmdk(true)} />
        <main className="dash-content" key={path}>
          {children}
        </main>
      </div>
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} />
    </div>
  );
}

/** Slow aurora, a fading grid and grain, fixed behind everything. */
function MotionBackground() {
  return (
    <div className="dash-bg" aria-hidden>
      <div className="aur a1" />
      <div className="aur a2" />
      <div className="aur a3" />
      <div className="dash-grid" />
      <div className="dash-grain" />
    </div>
  );
}

const VERIFY: Record<string, { label: string; tone: string }> = {
  not_started: { label: "Required", tone: "warn" },
  submitted: { label: "In review", tone: "info" },
  approved: { label: "Verified", tone: "ok" },
};

function Sidebar({ open }: { open: boolean }) {
  const s = useStore();
  const path = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
  const pending = s.payments.filter((p) => p.mode === s.mode && p.status === "pending").length;
  const unverifiedChannels = s.channels.filter((c) => c.status !== "verified").length;
  const v = VERIFY[s.verification];
  const initials = (s.business?.name || `${s.account?.firstName} ${s.account?.lastName}`)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    setBar(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [path]);

  const badge = (href: string) => {
    if (href === "/dashboard/payments" && pending) return <span className="nav-count">{pending}</span>;
    if (href === "/dashboard/channels" && unverifiedChannels) return <span className="nav-dot warn" />;
    if (href === "/dashboard/verification") return <span className={`nav-chip ${v.tone}`}>{v.label}</span>;
    return null;
  };

  return (
    <aside className={`side ${open ? "open" : ""}`}>
      <div className="side-top">
        <Link href="/dashboard" className="side-logo">
          <LogoMark size={24} />
          <span className="logo-word">
            swift<span>pal</span>
          </span>
        </Link>
        <div className="side-org">
          <span className="side-org-av">{initials || "SP"}</span>
          <div className="grow">
            <b>{s.business?.name || `${s.account?.firstName} ${s.account?.lastName}`}</b>
            <span>{s.business?.type === "individual" ? "Individual" : s.business?.type === "ngo" ? "Organisation" : "Business"}</span>
          </div>
        </div>
        <div className="mode-seg" role="group" aria-label="Mode">
          <button aria-pressed={s.mode === "test"} className="t" onClick={() => setMode("test")}>
            Test
          </button>
          <button aria-pressed={s.mode === "live"} className="l" onClick={() => setMode("live")}>
            Live
          </button>
          <i className={`mode-thumb ${s.mode}`} />
        </div>
      </div>

      <nav className="side-nav" aria-label="Dashboard" ref={navRef}>
        {bar && <span className="nav-bar" style={{ transform: `translateY(${bar.top}px)`, height: bar.height }} />}
        {NAV.map((g, i) => (
          <div key={i} className="side-group">
            {g.label && <div className="side-label">{g.label}</div>}
            {g.items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(n, path) ? "page" : undefined}>
                <Icon name={n.icon} size={16} />
                <span className="grow">{n.label}</span>
                {badge(n.href)}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-foot">
        {s.verification !== "approved" && (
          <Link href="/dashboard/verification" className="side-verify">
            <span className={`ring ${s.verification}`}>
              <Icon name={s.verification === "submitted" ? "clock" : "idcard"} size={15} />
            </span>
            <span className="grow">
              <b>{s.verification === "submitted" ? "Verification in review" : "Verify your account"}</b>
              <span>{s.verification === "submitted" ? "We'll email you" : "National ID and selfie"}</span>
            </span>
            <Icon name="chevronRight" size={14} />
          </Link>
        )}
        <div className="side-row">
          <ThemeSwitch label={false} />
          <button
            className="side-reset"
            title="Reset preview data"
            onClick={() => {
              if (confirm("Clear all preview data in this browser and start over?")) {
                resetPrototype();
                router.push("/");
              }
            }}
          >
            Preview · reset
          </button>
        </div>
      </div>
    </aside>
  );
}

const NEW_ITEMS: { a: Action; label: string; icon: IconName }[] = [
  { a: "payment", label: "Request payment", icon: "collect" },
  { a: "payout", label: "Send payout", icon: "payout" },
  { a: "topup-fee", label: "Top up wallet", icon: "wallet" },
  { a: "channel", label: "Add Till or Paybill", icon: "channel" },
  { a: "key", label: "Create API key", icon: "key" },
];

function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const s = useStore();
  const path = usePathname();
  const router = useRouter();
  const { open } = useActions();
  const [menu, setMenu] = useState<"new" | "bell" | "me" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const item = currentItem(path);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  useEffect(() => setMenu(null), [path]);

  const notes = useMemo(() => {
    const out: { icon: IconName; tone: string; text: string; at: string; href: string }[] = [];
    const bal = s.balances[s.mode];
    if (bal.fee < s.lowBalanceAt) out.push({ icon: "alert", tone: "warn", text: `Fee credit is ${money(Math.floor(bal.fee))}`, at: new Date().toISOString(), href: "/dashboard/wallet" });
    if (s.verification === "not_started") out.push({ icon: "idcard", tone: "warn", text: "Verify your account to enable live payouts", at: s.account!.createdAt, href: "/dashboard/verification" });
    s.payouts
      .filter((p) => p.mode === s.mode && p.status === "failed")
      .slice(0, 2)
      .forEach((p) => out.push({ icon: "payout", tone: "bad", text: `Payout ${money(p.amount)} failed and was refunded`, at: p.createdAt, href: "/dashboard/payouts" }));
    s.payments
      .filter((p) => p.mode === s.mode && p.status === "succeeded")
      .slice(0, 3)
      .forEach((p) => out.push({ icon: "collect", tone: "ok", text: `${money(p.amount)} received · ${p.reference}`, at: p.createdAt, href: "/dashboard/payments" }));
    return out.slice(0, 6);
  }, [s]);

  const initials = `${s.account?.firstName[0] ?? ""}${s.account?.lastName[0] ?? ""}`.toUpperCase() || "SP";

  return (
    <header className="topbar" ref={wrap}>
      <button className="icon-btn topbar-menu" onClick={onMenu} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>
      <div className="crumbs">
        {item?.group && item.group !== "General" && <span className="crumb-g">{item.group}</span>}
        <b>{item?.label ?? "Dashboard"}</b>
      </div>

      <button className="search-btn" onClick={onSearch}>
        <Icon name="search" size={14} />
        <span>Search or jump to…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="top-actions">
        <div className="pop-wrap">
          <button className="btn btn-pine btn-sm new-btn" onClick={() => setMenu(menu === "new" ? null : "new")} aria-expanded={menu === "new"}>
            <Icon name="plus" size={14} /> New
          </button>
          {menu === "new" && (
            <div className="pop" role="menu">
              {NEW_ITEMS.map((n) => (
                <button key={n.a} role="menuitem" onClick={() => { setMenu(null); open(n.a); }}>
                  <span className="pop-ic"><Icon name={n.icon} size={14} /></span>
                  {n.a === "payment" && s.mode === "test" ? "Send test STK Push" : n.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pop-wrap">
          <button className="icon-btn" onClick={() => setMenu(menu === "bell" ? null : "bell")} aria-label="Notifications" aria-expanded={menu === "bell"}>
            <Icon name="bell" size={17} />
            {notes.some((n) => n.tone !== "ok") && <span className="bell-dot" />}
          </button>
          {menu === "bell" && (
            <div className="pop wide" role="menu">
              <div className="pop-head">Notifications</div>
              {notes.length === 0 && <div className="pop-empty">Nothing new.</div>}
              {notes.map((n, i) => (
                <Link key={i} href={n.href} className="note" role="menuitem">
                  <span className={`note-ic ${n.tone}`}><Icon name={n.icon} size={13} /></span>
                  <span className="grow">{n.text}</span>
                  <time>{timeAgo(n.at)}</time>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="pop-wrap">
          <button className="avatar-btn" onClick={() => setMenu(menu === "me" ? null : "me")} aria-label="Account" aria-expanded={menu === "me"}>
            {initials}
          </button>
          {menu === "me" && (
            <div className="pop" role="menu">
              <div className="pop-head">
                <b>{s.account?.firstName} {s.account?.lastName}</b>
                <span>{s.account?.email}</span>
              </div>
              <Link href="/dashboard/settings" role="menuitem"><span className="pop-ic"><Icon name="settings" size={14} /></span>Settings</Link>
              <Link href="/docs" role="menuitem"><span className="pop-ic"><Icon name="book" size={14} /></span>Documentation</Link>
              <button role="menuitem" onClick={() => { signOut(); router.push("/login"); }}>
                <span className="pop-ic"><Icon name="logout" size={14} /></span>Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
