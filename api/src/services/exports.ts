import type { App, Mode } from "../app.js";
import { ApiError, kes } from "../lib.js";

// CSV statements for accountants: payments, payouts and the wallet ledger over
// a date range, in Nairobi time.

const MAX_ROWS = 50_000;
const MAX_DAYS = 366;

/**
 * Text a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a
 * leading apostrophe. References, recipient names and metadata come from
 * outside, so they're treated as hostile.
 */
function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** Days are Nairobi calendar days; `to` is inclusive. */
export function range(from?: string, to?: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const f = from && day.test(from) ? from : new Date(Date.now() + 3 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);
  const t = to && day.test(to) ? to : today;
  const start = new Date(`${f}T00:00:00+03:00`);
  const end = new Date(new Date(`${t}T00:00:00+03:00`).getTime() + 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, "invalid_range", "Pick a start date on or before the end date.");
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_DAYS) throw new ApiError(400, "invalid_range", "Export at most a year at a time.");
  return { from: f, to: t, start: start.toISOString(), end: end.toISOString() };
}

const nairobi = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().replace("T", " ").slice(0, 19) : "");

export async function payments(app: App, merchantId: string, mode: Mode, r: ReturnType<typeof range>) {
  const { rows } = await app.db.query(
    `select p.id, p.created_at, p.completed_at, p.status, p.amount, p.fee_cents, p.fee_charged, p.phone, p.reference, p.mpesa_receipt, p.failure_message, p.channel_id, l.title as link
     from payments p left join payment_links l on l.id = p.link_id
     where p.merchant_id = $1 and p.mode = $2 and p.purpose = 'charge' and p.created_at >= $3 and p.created_at < $4 order by p.created_at limit $5`,
    [merchantId, mode, r.start, r.end, MAX_ROWS],
  );
  return csv([
    ["Date (EAT)", "Completed (EAT)", "Payment ID", "Status", "Amount (KES)", "Fee (KES)", "Phone", "Reference", "M-Pesa receipt", "Channel", "Payment link", "Failure reason"],
    ...rows.map((p) => [
      nairobi(p.created_at as string),
      nairobi(p.completed_at as string | null),
      p.id,
      p.status === "confirming" ? "pending" : p.status,
      Number(p.amount),
      p.fee_charged ? kes(Number(p.fee_cents)) : 0,
      p.phone,
      p.reference,
      p.mpesa_receipt,
      p.channel_id,
      p.link,
      p.failure_message,
    ]),
  ]);
}

export async function payouts(app: App, merchantId: string, mode: Mode, r: ReturnType<typeof range>) {
  const { rows } = await app.db.query(
    `select id, created_at, completed_at, purpose, status, amount, fee_cents, phone, recipient_name, reference, reason, mpesa_receipt, batch_id, refund_of, failure_message
     from payouts where merchant_id = $1 and mode = $2 and created_at >= $3 and created_at < $4 order by created_at limit $5`,
    [merchantId, mode, r.start, r.end, MAX_ROWS],
  );
  return csv([
    ["Date (EAT)", "Completed (EAT)", "Payout ID", "Type", "Status", "Amount (KES)", "Fee (KES)", "Phone", "Recipient", "Reference", "Reason", "M-Pesa receipt", "Batch", "Refund of payment", "Failure reason"],
    ...rows.map((p) => [
      nairobi(p.created_at as string),
      nairobi(p.completed_at as string | null),
      p.id,
      p.purpose === "withdrawal" ? "withdrawal" : p.refund_of ? "refund" : "payout",
      p.status === "queued" ? "processing" : p.status,
      Number(p.amount),
      p.status === "failed" ? 0 : kes(Number(p.fee_cents)),
      p.phone,
      p.recipient_name,
      p.reference,
      p.reason,
      p.mpesa_receipt,
      p.batch_id,
      p.refund_of,
      p.failure_message,
    ]),
  ]);
}

const KIND: Record<string, string> = {
  top_up: "Top-up",
  fee: "Fee",
  starter_credit: "Starter credit",
  adjustment: "Adjustment by SwiftPal",
  payout: "Payout",
  payout_fee: "Payout fee",
  withdrawal: "Withdrawal",
};

export async function ledger(app: App, merchantId: string, mode: Mode, r: ReturnType<typeof range>) {
  const { rows } = await app.db.query(
    `select id, created_at, account, kind, amount_cents, ref from ledger_entries
     where merchant_id = $1 and mode = $2 and created_at >= $3 and created_at < $4 order by created_at, id limit $5`,
    [merchantId, mode, r.start, r.end, MAX_ROWS],
  );
  return csv([
    ["Date (EAT)", "Entry ID", "Account", "Type", "Amount (KES)", "Reference"],
    ...rows.map((l) => [nairobi(l.created_at as string), l.id, l.account === "fee" ? "Fee credit" : "Payout float", KIND[l.kind as string] ?? l.kind, kes(Number(l.amount_cents)), l.ref]),
  ]);
}

export const filename = (what: string, r: ReturnType<typeof range>) => `swiftpal-${what}-${r.from}-to-${r.to}.csv`;
