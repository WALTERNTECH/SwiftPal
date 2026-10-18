import type { IconName } from "@/components/Icon";
import type { Perm } from "@/lib/api";

/** `perm` hides an item from roles that can't use it; everything else is readable by the whole team. */
export type NavItem = { href: string; label: string; icon: IconName; exact?: boolean; keywords?: string; perm?: Perm };
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: "home", exact: true, keywords: "home dashboard balance" },
      { href: "/dashboard/analytics", label: "Analytics", icon: "chart", keywords: "stats statistics reports volume success rate" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/dashboard/payments", label: "Payments", icon: "collect", keywords: "stk push collections transactions" },
      { href: "/dashboard/links", label: "Payment links", icon: "link", keywords: "pay page share whatsapp instagram no code checkout" },
      { href: "/dashboard/payouts", label: "Payouts", icon: "payout", keywords: "b2c disbursements bulk refunds" },
      { href: "/dashboard/wallet", label: "Wallet", icon: "wallet", keywords: "balance fee credit float top up ledger" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/channels", label: "Channels", icon: "channel", keywords: "till paybill shortcode" },
      { href: "/dashboard/verification", label: "Verification", icon: "shield", keywords: "kyc id selfie documents" },
      { href: "/dashboard/pricing", label: "Pricing", icon: "tag", keywords: "rates fees charges bands" },
    ],
  },
  {
    label: "Developers",
    items: [
      { href: "/dashboard/developers", label: "API keys", icon: "key", exact: true, keywords: "secret token", perm: "developers" },
      { href: "/dashboard/developers/webhooks", label: "Webhooks", icon: "webhook", keywords: "callbacks events", perm: "developers" },
      { href: "/dashboard/developers/logs", label: "Request logs", icon: "logs", keywords: "requests api calls", perm: "developers" },
    ],
  },
  {
    items: [{ href: "/dashboard/settings", label: "Settings", icon: "settings", keywords: "profile business team security two-step 2fa password sessions" }],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label ?? "General" })));

export function isActive(item: NavItem, path: string) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(item.href + "/");
}

export function currentItem(path: string) {
  // Longest match wins, so /developers/webhooks beats /developers.
  return [...ALL_ITEMS].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(i, path));
}
