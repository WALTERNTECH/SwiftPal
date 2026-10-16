"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { ScrollProgress } from "@/components/motion";

const NAV = [
  { href: "/#products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/sandbox", label: "Sandbox" },
];

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => setOpen(false), [path]);

  const current = (href: string) => !href.includes("#") && (path === href || (href !== "/" && path.startsWith(href + "/")) || path === href);

  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""} ${open ? "open" : ""}`}>
      <div className="site-header-inner">
        <Logo />
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={current(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="site-actions">
          <Link href="/login" className="site-signin">
            Sign in
          </Link>
          <Link href="/signup" className="split-btn">
            <span>Start integrating</span>
            <i>
              <Icon name="arrowRight" size={14} />
            </i>
          </Link>
        </div>
        <button className="site-menu" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span />
          <span />
        </button>
      </div>
      <ScrollProgress />
      <div className="site-drawer" aria-hidden={!open}>
        {NAV.map((n, i) => (
          <Link key={n.href} href={n.href} style={{ ["--i" as string]: i }} tabIndex={open ? 0 : -1}>
            {n.label}
            <Icon name="arrowUpRight" size={16} />
          </Link>
        ))}
        <div className="site-drawer-actions" style={{ ["--i" as string]: NAV.length }}>
          <Link href="/login" className="btn btn-line btn-lg btn-block" tabIndex={open ? 0 : -1}>
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-pine btn-lg btn-block" tabIndex={open ? 0 : -1}>
            Start integrating <Icon name="arrowRight" size={15} className="arrow" />
          </Link>
        </div>
      </div>
    </header>
  );
}
