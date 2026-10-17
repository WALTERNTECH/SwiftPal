import type { Payment, Payout } from "./store";

const DAY = 86_400_000;

export type Range = 7 | 14 | 30;
export type DayPoint = { t: number; label: string; collected: number; paidOut: number; paid: number; settled: number; prompts: number };

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** One point per calendar day for the last `days` days, oldest first. */
export function daily(payments: Payment[], payouts: Payout[], days: number, endOffsetDays = 0): DayPoint[] {
  const today = startOfDay(Date.now()) - endOffsetDays * DAY;
  const pts: DayPoint[] = [];
  const index = new Map<number, DayPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * DAY;
    const p: DayPoint = {
      t,
      label: new Date(t).toLocaleDateString("en-KE", { day: "numeric", month: "short" }),
      collected: 0,
      paidOut: 0,
      paid: 0,
      settled: 0,
      prompts: 0,
    };
    pts.push(p);
    index.set(t, p);
  }
  for (const p of payments) {
    const slot = index.get(startOfDay(new Date(p.createdAt).getTime()));
    if (!slot) continue;
    slot.prompts++;
    if (p.status !== "pending") slot.settled++;
    if (p.status === "succeeded") {
      slot.paid++;
      slot.collected += p.amount;
    }
  }
  for (const p of payouts) {
    const slot = index.get(startOfDay(new Date(p.createdAt).getTime()));
    if (slot && p.status === "succeeded") slot.paidOut += p.amount;
  }
  return pts;
}

export type Summary = {
  collected: number;
  paidOut: number;
  paid: number;
  prompts: number;
  settled: number;
  rate: number | null;
  avgTicket: number | null;
  fees: number;
  payouts: number;
};

export function summarise(payments: Payment[], payouts: Payout[], from: number, to: number): Summary {
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t < to;
  };
  const ps = payments.filter((p) => inRange(p.createdAt));
  const paid = ps.filter((p) => p.status === "succeeded");
  const settled = ps.filter((p) => p.status !== "pending");
  const po = payouts.filter((p) => inRange(p.createdAt) && p.status === "succeeded");
  const collected = paid.reduce((a, p) => a + p.amount, 0);
  return {
    collected,
    paidOut: po.reduce((a, p) => a + p.amount, 0),
    paid: paid.length,
    prompts: ps.length,
    settled: settled.length,
    rate: settled.length ? paid.length / settled.length : null,
    avgTicket: paid.length ? collected / paid.length : null,
    fees: paid.reduce((a, p) => a + (p.feeCharged ? p.fee : 0), 0) + po.reduce((a, p) => a + p.fee, 0),
    payouts: po.length,
  };
}

/** This period and the one before it, for "vs previous" deltas. Rolling windows ending now, so a
 *  half-finished today is compared with the same hours a week earlier. */
export function compare(payments: Payment[], payouts: Payout[], days: Range) {
  const end = Date.now() + 1;
  const cur = summarise(payments, payouts, end - days * DAY, end);
  const prev = summarise(payments, payouts, end - 2 * days * DAY, end - days * DAY);
  return { cur, prev };
}

export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

export type Outcome = { key: string; label: string; code: string; count: number; tone: "ok" | "warn" | "bad" | "" };

export function outcomes(payments: Payment[], from: number): Outcome[] {
  const ps = payments.filter((p) => new Date(p.createdAt).getTime() >= from && p.status !== "pending");
  const n = (s: string) => ps.filter((p) => p.status === s).length;
  return [
    { key: "succeeded", label: "Paid", code: "0", count: n("succeeded"), tone: "ok" },
    { key: "cancelled", label: "Cancelled by customer", code: "1032", count: n("cancelled"), tone: "warn" },
    { key: "expired", label: "No response", code: "1037", count: n("expired"), tone: "" },
    { key: "failed", label: "Insufficient funds", code: "1", count: n("failed"), tone: "bad" },
  ];
}

/** Successful payments by hour of day. */
export function byHour(payments: Payment[], from: number) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, count: 0, amount: 0 }));
  for (const p of payments) {
    if (p.status !== "succeeded" || new Date(p.createdAt).getTime() < from) continue;
    const h = new Date(p.createdAt).getHours();
    hours[h].count++;
    hours[h].amount += p.amount;
  }
  return hours;
}

/** Ticket-size bands for successful payments. */
export function ticketBands(payments: Payment[], from: number) {
  const bands = [
    { label: "Under 500", min: 0, max: 499 },
    { label: "500 – 999", min: 500, max: 999 },
    { label: "1,000 – 2,499", min: 1000, max: 2499 },
    { label: "2,500 – 4,999", min: 2500, max: 4999 },
    { label: "5,000+", min: 5000, max: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  for (const p of payments) {
    if (p.status !== "succeeded" || new Date(p.createdAt).getTime() < from) continue;
    const b = bands.find((x) => p.amount >= x.min && p.amount <= x.max);
    if (b) b.count++;
  }
  return bands;
}

export const rangeStart = (days: number) => startOfDay(Date.now()) + DAY - days * DAY;
