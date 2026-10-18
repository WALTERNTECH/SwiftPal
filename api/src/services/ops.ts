import type { Account, App, Mode } from "../app.js";
import { one } from "../db.js";
import { ApiError, kes } from "../lib.js";
import { audit, type Admin } from "./admins.js";
import { emit } from "./events.js";
import { finalize, presentPayment, type Payment } from "./payments.js";
import { presentPayout, settle, type Payout } from "./payouts.js";
import * as verification from "./verification.js";
import { credit, debit, lock, present, read } from "./wallet.js";

// Everything the admin console does to merchants and money. Every change is
// written to admin_audit with who did it, from where, and the before/after.

type Actor = Pick<Admin, "id"> | null;
const actorId = (a: Actor) => a?.id ?? null;

// ---------- overview ----------

export async function overview(app: App) {
  const q = app.db;
  const m = await one<{ total: number; week: number; submitted: number; approved: number; suspended: number }>(
    q,
    `select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as week,
            count(*) filter (where verification_status = 'submitted')::int as submitted,
            count(*) filter (where verification_status = 'approved')::int as approved,
            count(*) filter (where suspended_at is not null)::int as suspended
     from merchants`,
  );
  const p = await one<{ day_amount: number; day_count: number; week_amount: number; week_count: number; week_settled: number }>(
    q,
    `select coalesce(sum(amount) filter (where status = 'succeeded' and created_at > now() - interval '1 day'), 0) as day_amount,
            count(*) filter (where status = 'succeeded' and created_at > now() - interval '1 day')::int as day_count,
            coalesce(sum(amount) filter (where status = 'succeeded' and created_at > now() - interval '7 days'), 0) as week_amount,
            count(*) filter (where status = 'succeeded' and created_at > now() - interval '7 days')::int as week_count,
            count(*) filter (where status in ('succeeded','failed','cancelled','expired') and created_at > now() - interval '7 days')::int as week_settled
     from payments where mode = 'live' and purpose = 'charge'`,
  );
  const o = await one<{ week_amount: number; week_count: number; week_failed: number }>(
    q,
    `select coalesce(sum(amount) filter (where status = 'succeeded'), 0) as week_amount,
            count(*) filter (where status = 'succeeded')::int as week_count,
            count(*) filter (where status in ('failed','reversed'))::int as week_failed
     from payouts where mode = 'live' and created_at > now() - interval '7 days'`,
  );
  const fees = await one<{ week: number; month: number; all: number }>(
    q,
    `select coalesce(-sum(amount_cents) filter (where created_at > now() - interval '7 days'), 0) as week,
            coalesce(-sum(amount_cents) filter (where created_at > now() - interval '30 days'), 0) as month,
            coalesce(-sum(amount_cents), 0) as all
     from ledger_entries where mode = 'live' and kind = 'fee'`,
  );
  const held = await one<{ float: number; fee: number }>(
    q,
    `select coalesce(sum(available_cents + held_cents) filter (where account = 'float'), 0) as float,
            coalesce(sum(available_cents + held_cents) filter (where account = 'fee'), 0) as fee
     from balances where mode = 'live'`,
  );
  const stuck = await one<{ payments: number; payouts: number; webhooks: number }>(
    q,
    `select (select count(*)::int from payments where mode = 'live' and status in ('pending','confirming') and created_at < now() - interval '10 minutes') as payments,
            (select count(*)::int from payouts where mode = 'live' and status in ('queued','processing') and created_at < now() - interval '10 minutes') as payouts,
            (select count(*)::int from webhook_deliveries d join events e on e.id = d.event_id where e.mode = 'live' and d.status = 'failed' and d.created_at > now() - interval '1 day') as webhooks`,
  );
  return {
    merchants: m,
    payments: { today: { amount: Number(p?.day_amount ?? 0), count: p?.day_count ?? 0 }, week: { amount: Number(p?.week_amount ?? 0), count: p?.week_count ?? 0, success_rate: p?.week_settled ? (p.week_count ?? 0) / p.week_settled : null } },
    payouts: { week: { amount: Number(o?.week_amount ?? 0), count: o?.week_count ?? 0, failed: o?.week_failed ?? 0 } },
    fees: { week: kes(Number(fees?.week ?? 0)), month: kes(Number(fees?.month ?? 0)), all: kes(Number(fees?.all ?? 0)) },
    holdings: { payout_float: kes(Number(held?.float ?? 0)), fee_credit: kes(Number(held?.fee ?? 0)) },
    attention: { kyc: m?.submitted ?? 0, stuck_payments: stuck?.payments ?? 0, stuck_payouts: stuck?.payouts ?? 0, failed_webhooks: stuck?.webhooks ?? 0 },
    system: system(app),
  };
}

export function system(app: App) {
  return {
    live_mpesa: !!app.mpesa.live,
    sms: !!app.cfg.sms,
    email: !!app.cfg.resendApiKey,
    verification_codes: app.cfg.codes,
    storage: app.cfg.storage.driver,
    admin_gateway: !!app.cfg.adminGateway,
    environment: app.cfg.env,
  };
}

// ---------- merchants ----------

export async function listMerchants(app: App, f: { q?: string; status?: string }) {
  const params: unknown[] = [];
  let where = "true";
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    const n = params.length;
    where += ` and (lower(m.name) like $${n} or lower(u.email) like $${n} or u.phone like $${n} or lower(m.account_code) like $${n} or lower(m.id) like $${n})`;
  }
  if (f.status === "suspended") where += ` and m.suspended_at is not null`;
  else if (f.status) {
    params.push(f.status);
    where += ` and m.verification_status = $${params.length}`;
  }
  const { rows } = await app.db.query(
    `select m.id, m.name, m.type, m.account_code, m.verification_status, m.live_enabled, m.suspended_at, m.created_at,
            u.email, u.phone, u.first_name, u.last_name,
            (select available_cents from balances b where b.merchant_id = m.id and b.mode = 'live' and b.account = 'fee') as fee_cents,
            (select available_cents from balances b where b.merchant_id = m.id and b.mode = 'live' and b.account = 'float') as float_cents,
            (select count(*)::int from channels c where c.merchant_id = m.id and c.removed_at is null) as channels
     from merchants m join users u on u.merchant_id = m.id and u.role = 'owner'
     where ${where} order by m.created_at desc limit 200`,
    params,
  );
  return rows.map((r) => ({ ...r, fee_credit: kes(Number(r.fee_cents ?? 0)), payout_float: kes(Number(r.float_cents ?? 0)), fee_cents: undefined, float_cents: undefined }));
}

export async function merchantDetail(app: App, id: string) {
  const q = app.db;
  const merchant = await one(q, `select * from merchants where id = $1`, [id]);
  if (!merchant) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
  const users = (await q.query(`select id, email, phone, first_name, last_name, role, email_verified_at, phone_verified_at, created_at from users where merchant_id = $1`, [id])).rows;
  const channels = (await q.query(`select id, kind, shortcode, account_number, display_name, status, is_default, created_at from channels where merchant_id = $1 and removed_at is null order by created_at`, [id])).rows;
  const keys = (
    await q.query(`select id, name, mode, prefix, last4, scopes, created_at, last_used_at from api_keys where merchant_id = $1 and revoked_at is null order by created_at`, [id])
  ).rows.map((k) => ({ id: k.id, name: k.name, mode: k.mode, masked: `${k.prefix}${"•".repeat(12)}${k.last4}`, scopes: k.scopes, created_at: k.created_at, last_used_at: k.last_used_at }));
  const payments = (await q.query<Payment>(`select * from payments where merchant_id = $1 and mode = 'live' order by created_at desc limit 25`, [id])).rows.map((p) => ({ ...presentPayment(p), purpose: p.purpose, raw_status: p.status }));
  const payouts = (await q.query<Payout>(`select * from payouts where merchant_id = $1 and mode = 'live' order by created_at desc limit 25`, [id])).rows.map((p) => ({ ...presentPayout(p), purpose: p.purpose, raw_status: p.status }));
  const ledger = (
    await q.query(`select id, account, kind, amount_cents, ref, created_at from ledger_entries where merchant_id = $1 and mode = 'live' order by created_at desc limit 60`, [id])
  ).rows.map((l) => ({ ...l, amount: kes(Number(l.amount_cents)), amount_cents: undefined }));
  return {
    merchant,
    users,
    balances: { live: present(await read(q, id, "live")) },
    channels,
    keys,
    verification: await verification.current(app, id),
    payments,
    payouts,
    ledger,
    audit: await listAudit(app, { type: "merchant", id, limit: 40 }),
  };
}

/** Manual reconciliation: money in or out of one balance, with a reason that stays on record. */
export async function adjust(
  app: App,
  actor: Actor,
  merchantId: string,
  a: { mode: Mode; account: Account; direction: "credit" | "debit"; amount: number; reason: string; reference?: string },
  ip?: string,
) {
  const cents = Math.round(a.amount * 100);
  if (!(cents > 0) || cents > 1_000_000_00) throw new ApiError(400, "invalid_amount", "Enter an amount between KES 0.01 and KES 1,000,000.");
  if (a.reason.trim().length < 5) throw new ApiError(400, "reason_required", "Say why, in a few words. It stays on the record.");
  return app.db.tx(async (q) => {
    if (!(await one(q, `select 1 from merchants where id = $1`, [merchantId]))) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
    const before = await lock(q, merchantId, a.mode);
    const ref = a.reference?.trim() || "admin";
    if (a.direction === "credit") await credit(q, merchantId, a.mode, a.account, cents, "adjustment", ref);
    else await debit(q, merchantId, a.mode, a.account, cents, "adjustment", ref);
    const after = await read(q, merchantId, a.mode);
    await audit(
      q,
      actorId(actor),
      `balance.${a.direction}`,
      { type: "merchant", id: merchantId },
      { mode: a.mode, account: a.account, amount: cents / 100, reason: a.reason.trim(), reference: ref, before: kes(before[a.account].available), after: kes(after[a.account].available) },
      ip,
    );
    return present(after);
  });
}

export async function setSuspended(app: App, actor: Actor, merchantId: string, suspended: boolean, reason: string | undefined, ip?: string) {
  if (suspended && (reason ?? "").trim().length < 5) throw new ApiError(400, "reason_required", "Say why the account is suspended.");
  await app.db.tx(async (q) => {
    const { rows } = await q.query(
      `update merchants set suspended_at = ${suspended ? "now()" : "null"}, suspended_reason = $2 where id = $1 returning id`,
      [merchantId, suspended ? reason!.trim() : null],
    );
    if (!rows.length) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
    await audit(q, actorId(actor), suspended ? "merchant.suspended" : "merchant.unsuspended", { type: "merchant", id: merchantId }, { reason: reason?.trim() ?? null }, ip);
  });
}

export async function decideVerification(app: App, actor: Actor, id: string, approve: boolean, note: string | undefined, ip?: string) {
  const out = await verification.decide(app, id, approve, note);
  const v = await one<{ merchant_id: string }>(app.db, `select merchant_id from verifications where id = $1`, [id]);
  await audit(app.db, actorId(actor), approve ? "kyc.approved" : "kyc.rejected", { type: "merchant", id: v?.merchant_id }, { verification: id, note: note ?? null }, ip);
  return out;
}

export async function revokeKey(app: App, actor: Actor, keyId: string, ip?: string) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query<{ merchant_id: string; name: string }>(`update api_keys set revoked_at = now() where id = $1 and revoked_at is null returning merchant_id, name`, [keyId]);
    if (!rows.length) throw new ApiError(404, "not_found", "No active key with that id.", "not_found");
    await audit(q, actorId(actor), "key.revoked", { type: "merchant", id: rows[0].merchant_id }, { key: keyId, name: rows[0].name }, ip);
  });
}

// ---------- payments and payouts ----------

export async function listPayments(app: App, f: { q?: string; status?: string; purpose?: string; mode?: string; stuck?: boolean }) {
  const params: unknown[] = [f.mode === "test" ? "test" : "live"];
  let where = `p.mode = $1`;
  if (f.status) {
    params.push(f.status);
    where += ` and p.status = $${params.length}`;
  }
  if (f.purpose) {
    params.push(f.purpose);
    where += ` and p.purpose = $${params.length}`;
  }
  if (f.stuck) where += ` and p.status in ('pending','confirming') and p.created_at < now() - interval '10 minutes'`;
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    const n = params.length;
    where += ` and (lower(p.id) like $${n} or lower(p.reference) like $${n} or p.phone like $${n} or lower(coalesce(p.mpesa_receipt,'')) like $${n} or lower(m.name) like $${n})`;
  }
  const { rows } = await app.db.query<Payment & { merchant_name: string }>(
    `select p.*, m.name as merchant_name from payments p join merchants m on m.id = p.merchant_id where ${where} order by p.created_at desc limit 150`,
    params,
  );
  return rows.map((p) => ({ ...presentPayment(p), purpose: p.purpose, merchant_id: p.merchant_id, merchant_name: p.merchant_name, raw_status: p.status }));
}

export async function listPayouts(app: App, f: { q?: string; status?: string; mode?: string; stuck?: boolean }) {
  const params: unknown[] = [f.mode === "test" ? "test" : "live"];
  let where = `o.mode = $1`;
  if (f.status) {
    params.push(f.status);
    where += ` and o.status = $${params.length}`;
  }
  if (f.stuck) where += ` and o.status in ('queued','processing') and o.created_at < now() - interval '10 minutes'`;
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    const n = params.length;
    where += ` and (lower(o.id) like $${n} or lower(o.reference) like $${n} or o.phone like $${n} or lower(coalesce(o.mpesa_receipt,'')) like $${n} or lower(m.name) like $${n})`;
  }
  const { rows } = await app.db.query<Payout & { merchant_name: string }>(
    `select o.*, m.name as merchant_name from payouts o join merchants m on m.id = o.merchant_id where ${where} order by o.created_at desc limit 150`,
    params,
  );
  return rows.map((p) => ({ ...presentPayout(p), purpose: p.purpose, merchant_id: p.merchant_id, merchant_name: p.merchant_name, raw_status: p.status }));
}

/**
 * For a payment M-Pesa completed but SwiftPal never heard about (or the
 * reverse). Open payments settle through the normal path; a payment already
 * expired or failed can still be confirmed with its M-Pesa receipt, which
 * charges the fee and, for a top-up, credits the wallet.
 */
export async function resolvePayment(app: App, actor: Actor, id: string, r: { outcome: "succeeded" | "failed"; receipt?: string; note: string }, ip?: string) {
  if (r.note.trim().length < 5) throw new ApiError(400, "reason_required", "Say why, in a few words. It stays on the record.");
  const receipt = r.receipt?.trim().toUpperCase();
  if (r.outcome === "succeeded" && !/^[A-Z0-9]{8,12}$/.test(receipt ?? "")) throw new ApiError(400, "receipt_required", "Enter the M-Pesa receipt, e.g. TJG4K2XQ8P.");
  const p = await one<Payment>(app.db, `select * from payments where id = $1`, [id]);
  if (!p) throw new ApiError(404, "not_found", "No such payment.", "not_found");
  if (p.status === "succeeded") throw new ApiError(409, "already_succeeded", "This payment already succeeded.");

  if (p.status === "pending" || p.status === "confirming") {
    await finalize(app, id, r.outcome === "succeeded" ? { status: "succeeded", receipt } : { status: "failed", code: "manual", message: r.note.trim() });
  } else if (r.outcome === "succeeded") {
    // Already closed as failed, cancelled or expired, so the fee hold was released: charge it from available now.
    await app.db.tx(async (q) => {
      const cur = await one<Payment>(q, `select * from payments where id = $1 for update`, [id]);
      if (!cur || cur.status === "succeeded") throw new ApiError(409, "already_succeeded", "This payment already succeeded.");
      const b = await lock(q, cur.merchant_id, cur.mode);
      const fee = Number(cur.fee_cents);
      const charge = fee > 0 && !!cur.fee_account && b[cur.fee_account as Account].available >= fee;
      if (charge) await debit(q, cur.merchant_id, cur.mode, cur.fee_account as Account, fee, "fee", cur.id);
      if (cur.purpose === "topup" && cur.topup_account) await credit(q, cur.merchant_id, cur.mode, cur.topup_account as Account, Number(cur.amount) * 100, "top_up", receipt!);
      await q.query(
        `update payments set status = 'succeeded', mpesa_receipt = $2, failure_code = null, failure_message = null, fee_charged = $3, updated_at = now(), completed_at = coalesce(completed_at, now()) where id = $1`,
        [cur.id, receipt, charge],
      );
      const done = (await one<Payment>(q, `select * from payments where id = $1`, [cur.id]))!;
      if (cur.purpose === "charge") await emit(q, cur.merchant_id, cur.mode, "payment.succeeded", presentPayment(done));
      if (cur.purpose === "topup") await emit(q, cur.merchant_id, cur.mode, "wallet.topped_up", { account: cur.topup_account, amount: Number(cur.amount), mpesa_receipt: receipt });
    });
  } else {
    throw new ApiError(409, "already_closed", `This payment is already ${p.status}.`);
  }
  await audit(app.db, actorId(actor), `payment.resolved_${r.outcome}`, { type: "merchant", id: p.merchant_id }, { payment: id, purpose: p.purpose, amount: Number(p.amount), from: p.status, receipt: receipt ?? null, note: r.note.trim() }, ip);
  const after = (await one<Payment>(app.db, `select * from payments where id = $1`, [id]))!;
  return { ...presentPayment(after), purpose: after.purpose };
}

/** A payout or withdrawal M-Pesa settled without a result reaching SwiftPal: mark it paid, or failed and refunded. */
export async function resolvePayout(app: App, actor: Actor, id: string, r: { outcome: "succeeded" | "failed"; receipt?: string; note: string }, ip?: string) {
  if (r.note.trim().length < 5) throw new ApiError(400, "reason_required", "Say why, in a few words. It stays on the record.");
  const receipt = r.receipt?.trim().toUpperCase();
  const p = await one<Payout>(app.db, `select * from payouts where id = $1`, [id]);
  if (!p) throw new ApiError(404, "not_found", "No such payout.", "not_found");
  if (p.status !== "queued" && p.status !== "processing") throw new ApiError(409, "already_closed", `This payout is already ${p.status}.`);
  if (r.outcome === "succeeded") {
    if (p.status === "queued") throw new ApiError(409, "not_sent", "This payout was never sent to M-Pesa. Fail it to refund the merchant.");
    if (!/^[A-Z0-9]{8,12}$/.test(receipt ?? "")) throw new ApiError(400, "receipt_required", "Enter the M-Pesa receipt, e.g. TJG4K2XQ8P.");
  }
  await settle(app, id, r.outcome === "succeeded" ? { ok: true, receipt } : { ok: false, code: "manual", message: r.note.trim() });
  await audit(app.db, actorId(actor), `payout.resolved_${r.outcome}`, { type: "merchant", id: p.merchant_id }, { payout: id, purpose: p.purpose, amount: Number(p.amount), from: p.status, receipt: receipt ?? null, note: r.note.trim() }, ip);
  const after = (await one<Payout>(app.db, `select * from payouts where id = $1`, [id]))!;
  return { ...presentPayout(after), purpose: after.purpose };
}

// ---------- audit ----------

export async function listAudit(app: App, f: { type?: string; id?: string; limit?: number }) {
  const params: unknown[] = [];
  let where = "true";
  if (f.type) {
    params.push(f.type);
    where += ` and l.target_type = $${params.length}`;
  }
  if (f.id) {
    params.push(f.id);
    where += ` and l.target_id = $${params.length}`;
  }
  params.push(Math.min(f.limit ?? 100, 300));
  const { rows } = await app.db.query(
    `select l.id, l.action, l.target_type, l.target_id, l.detail, l.ip, l.created_at, a.name as admin_name, a.email as admin_email
     from admin_audit l left join admins a on a.id = l.admin_id where ${where} order by l.created_at desc limit $${params.length}`,
    params,
  );
  return rows;
}
