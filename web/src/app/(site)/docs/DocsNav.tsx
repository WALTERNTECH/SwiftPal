"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export type NavItem = { slug: string; title: string; group: string };

const hrefOf = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
const groupsOf = (items: NavItem[]) => Array.from(new Set(items.map((d) => d.group)));

export function DocsNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="docs-nav" aria-label="Documentation">
      {groupsOf(items).map((g) => (
        <div key={g} className="docs-nav-group">
          <div className="eyebrow">{g}</div>
          {items
            .filter((d) => d.group === g)
            .map((d) => (
              <Link key={d.slug} href={hrefOf(d.slug)} aria-current={path === hrefOf(d.slug) ? "page" : undefined}>
                {d.title}
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );
}

export function DocsMobileNav({ items, current }: { items: NavItem[]; current: string }) {
  const router = useRouter();
  return (
    <div className="docs-mobile-nav" style={{ marginBottom: 24 }}>
      <select className="select" value={current} onChange={(e) => router.push(hrefOf(e.target.value))} aria-label="Jump to page">
        {groupsOf(items).map((g) => (
          <optgroup key={g} label={g}>
            {items
              .filter((d) => d.group === g)
              .map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
