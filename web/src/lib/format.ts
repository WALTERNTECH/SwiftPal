const kes = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const kes2 = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number) => `KES ${kes.format(n)}`;
export const money2 = (n: number) => `KES ${kes2.format(n)}`;
export const num = (n: number) => kes.format(n);

export function fee(n: number) {
  if (n === 0) return "Free";
  return Number.isInteger(n) ? `KES ${n}` : `KES ${n.toFixed(2)}`;
}

/** 0712345678 / +254712345678 / 712345678 → 254712345678, or null. */
export function normalisePhone(input: string): string | null {
  const d = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return null;
}

export const maskPhone = (p: string) => `${p.slice(0, 6)}•••${p.slice(-3)}`;

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "2026-10-17" (a Nairobi calendar day from the API) → "17 Oct". */
export const dayLabel = (date: string) => new Date(`${date}T12:00:00+03:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

/** 254712345678 (or the API's "254712•••678") → "+254 712 ••• 678". */
export const phoneHint = (p: string) => `+254 ${p.slice(3, 6)} ••• ${p.slice(-3)}`;
