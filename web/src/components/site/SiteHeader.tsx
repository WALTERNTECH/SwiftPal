"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

const NAV = [
  { href: "/#products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/sandbox", label: "Sandbox" },
];

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Logo />
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path === n.href || (n.href !== "/" && path.startsWith(n.href) && !n.href.includes("#")) ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="site-actions">
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-ink">
            Create account
          </Link>
        </div>
        <button className="btn btn-ghost site-menu" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "x" : "menu"} size={18} />
        </button>
      </div>
      {open && (
        <div className="site-drawer">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)}>
              {n.label}
            </Link>
          ))}
          <div className="site-drawer-actions">
            <Link href="/login" className="btn btn-line btn-block">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-ink btn-block">
              Create account
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
