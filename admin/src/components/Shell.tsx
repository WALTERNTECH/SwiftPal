"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, clearCache, useApi, useMe } from "@/lib/api";
import { Icon, type IconName } from "./Icon";
import { LogoMark } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";
import { ToastHost } from "./ui";

const NAV: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: "/", label: "Overview", icon: "home", exact: true },
  { href: "/verifications", label: "Verifications", icon: "shield" },
  { href: "/merchants", label: "Merchants", icon: "building" },
  { href: "/payments", label: "Payments", icon: "collect" },
  { href: "/payouts", label: "Payouts", icon: "payout" },
  { href: "/audit", label: "Audit log", icon: "logs" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/system", label: "System", icon: "settings" },
];

const active = (href: string, path: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));

/** The signed-in frame. Anyone without a full session goes back to sign-in. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data: me, error } = useMe();
  const { data: queue } = useApi<unknown[]>(me?.stage === "full" ? "/verifications" : null, { refreshMs: 60_000 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (error?.status === 401) router.replace("/login");
    else if (me && me.stage !== "full") router.replace("/two-step");
  }, [me, error, router]);
  useEffect(() => setOpen(false), [path]);

  if (!me || me.stage !== "full" || !me.admin) {
    return (
      <div className="dash-loading">
        <LogoMark size={34} />
      </div>
    );
  }

  const initials = me.admin.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const current = NAV.filter((n) => active(n.href, path, n.exact)).at(-1);

  return (
    <ToastHost>
      <div className="dash adm">
        <div className="app-bg" aria-hidden />
        <aside className={`side ${open ? "open" : ""}`}>
          <div className="side-top">
            <Link href="/" className="side-logo">
              <LogoMark size={24} />
              <span className="logo-word">
                swift<span>pal</span>
              </span>
              <span className="admin-badge">Admin</span>
            </Link>
          </div>
          <nav className="side-nav" aria-label="Console">
            <div className="side-group">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} aria-current={active(n.href, path, n.exact) ? "page" : undefined}>
                  <Icon name={n.icon} size={16} />
                  <span className="grow">{n.label}</span>
                  {n.href === "/verifications" && !!queue?.length && <span className="nav-count">{queue.length}</span>}
                </Link>
              ))}
            </div>
          </nav>
          <div className="side-foot">
            <div className="side-org">
              <span className="monogram">{initials || "SP"}</span>
              <div className="grow">
                <b>{me.admin.name}</b>
                <span className="side-org-sub">{me.admin.role === "owner" ? "Owner" : "Admin"}</span>
              </div>
            </div>
            <div className="side-row">
              <ThemeSwitch label={false} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await api("/auth/logout", { method: "POST" }).catch(() => {});
                  clearCache();
                  router.replace("/login");
                }}
              >
                <Icon name="logout" size={14} /> Sign out
              </button>
            </div>
          </div>
        </aside>
        {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
        <div className="dash-main">
          <header className="topbar">
            <button className="icon-btn topbar-menu" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Icon name="menu" size={18} />
            </button>
            <div className="crumbs">
              <b>{current?.label ?? "Console"}</b>
            </div>
          </header>
          <main className="dash-content" key={path}>
            {children}
          </main>
        </div>
      </div>
    </ToastHost>
  );
}
