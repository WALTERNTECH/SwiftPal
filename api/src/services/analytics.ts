import type { App, Mode } from "../app.js";

const DAY = 86_400_000;
const EAT = 3 * 3_600_000;
/** Start of the Nairobi calendar day containing t, as a UTC timestamp. */
const dayStart = (t: number) => Math.floor((t + EAT) / DAY) * DAY - EAT;

type P = { amount: number; status: string; created_at: string; fee_cents: number; fee_charged: boolean };
type O = { amount: number; status: string; created_at: string; fee_cents: number; reason: string };

function summary(ps: P[], os: O[]) {
  const paid = ps.filter((p) => p.status === "succeeded");
  const settled = ps.filter((p) => !["pending", "confirming"].includes(p.status));
  const okOut = os.filter((p) => p.status === "succeeded");
  const collected = paid.reduce((a, p) => a + Number(p.amount), 0);
  return {
    collected,
    paid_out: okOut.reduce((a, p) => a + Number(p.amount), 0),
    successful: paid.length,
    prompts: ps.length,
    settled: settled.length,
    success_rate: settled.length ? paid.length / settled.length : null,
    average_ticket: paid.length ? collected / paid.length : null,
    fees: (paid.reduce((a, p) => a + (p.fee_charged ? Number(p.fee_cents) : 0), 0) + okOut.reduce((a, p) => a + Number(p.fee_cents), 0)) / 100,
    payouts: okOut.length,
    payouts_failed: os.filter((p) => p.status === "failed").length,
  };
}

/** Everything the Overview and Analytics pages draw, for one mode and range. */
export async function analytics(app: App, merchantId: string, mode: Mode, days: number) {
  const now = Date.now();
  const from = now - 2 * days * DAY;
  const { rows: ps } = await app.db.query<P>(
    `select amount, status, created_at, fee_cents, fee_charged from payments where merchant_id = $1 and mode = $2 and purpose = 'charge' and created_at >= $3`,
    [merchantId, mode, new Date(from).toISOString()],
  );
  const { rows: os } = await app.db.query<O>(
    `select amount, status, created_at, fee_cents, reason from payouts where merchant_id = $1 and mode = $2 and purpose = 'payout' and created_at >= $3`,
    [merchantId, mode, new Date(from).toISOString()],
  );
  const t = (x: { created_at: string }) => new Date(x.created_at).getTime();
  const cut = now - days * DAY;
  const cur = { p: ps.filter((x) => t(x) > cut), o: os.filter((x) => t(x) > cut) };
  const prev = { p: ps.filter((x) => t(x) <= cut), o: os.filter((x) => t(x) <= cut) };

  const today = dayStart(now);
  const series = Array.from({ length: days }, (_, i) => {
    const start = today - (days - 1 - i) * DAY;
    const inDay = (x: { created_at: string }) => t(x) >= start && t(x) < start + DAY;
    const dp = cur.p.filter(inDay);
    const paid = dp.filter((p) => p.status === "succeeded");
    const settled = dp.filter((p) => !["pending", "confirming"].includes(p.status));
    return {
      date: new Date(start + EAT).toISOString().slice(0, 10),
      collected: paid.reduce((a, p) => a + Number(p.amount), 0),
      paid_out: cur.o.filter(inDay).filter((p) => p.status === "succeeded").reduce((a, p) => a + Number(p.amount), 0),
      prompts: dp.length,
      successful: paid.length,
      settled: settled.length,
    };
  });

  const settledCur = cur.p.filter((p) => !["pending", "confirming"].includes(p.status));
  const count = (s: string) => settledCur.filter((p) => p.status === s).length;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, successful: 0 }));
  for (const p of cur.p) if (p.status === "succeeded") hours[new Date(t(p) + EAT).getUTCHours()].successful++;
  const bands = [
    ["Under 500", 0, 499],
    ["500 – 999", 500, 999],
    ["1,000 – 2,499", 1000, 2499],
    ["2,500 – 4,999", 2500, 4999],
    ["5,000+", 5000, Infinity],
  ].map(([label, min, max]) => ({ label, count: cur.p.filter((p) => p.status === "succeeded" && Number(p.amount) >= (min as number) && Number(p.amount) <= (max as number)).length }));
  const reasons: Record<string, number> = {};
  for (const o of cur.o) if (o.status === "succeeded") reasons[o.reason] = (reasons[o.reason] ?? 0) + Number(o.amount);

  return {
    mode,
    days,
    current: summary(cur.p, cur.o),
    previous: summary(prev.p, prev.o),
    series,
    outcomes: [
      { key: "succeeded", label: "Paid", code: "0", count: count("succeeded") },
      { key: "cancelled", label: "Cancelled by customer", code: "1032", count: count("cancelled") },
      { key: "expired", label: "No response", code: "1037", count: count("expired") },
      { key: "failed", label: "Declined", code: "1", count: count("failed") },
    ],
    hours,
    ticket_bands: bands,
    payout_reasons: Object.entries(reasons).map(([reason, amount]) => ({ reason, amount })).sort((a, b) => b.amount - a.amount),
  };
}
