import { driverFor, type Account, type App, type Mode } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, kes, newId } from "../lib.js";
import { MpesaRejected, type B2cRequest, type B2cResult } from "../mpesa/types.js";
import { b2cFeeCents } from "../pricing.js";
import type { Merchant } from "./accounts.js";
import { emit } from "./events.js";
import { capture, feeSource, hold, lock, release } from "./wallet.js";
import { lowBalanceCheck } from "./payments.js";

export type Payout = {
  id: string;
  merchant_id: string;
  mode: Mode;
  purpose: "payout" | "withdrawal";
  batch_id: string | null;
  phone: string;
  amount: number;
  reference: string;
  reason: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "reversed";
  fee_cents: number;
  fee_account: Account;
  recipient_name: string | null;
  mpesa_receipt: string | null;
  conversation_id: string | null;
  originator_conversation_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export const REASONS = ["salary", "withdrawal", "refund", "commission", "promotion", "other"] as const;
const TERMINAL = new Set(["succeeded", "failed", "reversed"]);

export const presentPayout = (p: Payout) => ({
  id: p.id,
  object: "payout",
  status: p.status === "queued" ? "processing" : p.status,
  amount: Number(p.amount),
  currency: "KES",
  phone: p.phone,
  recipient_name: p.recipient_name,
  reference: p.reference,
  reason: p.reason,
  batch: p.batch_id,
  mpesa_receipt: p.mpesa_receipt,
  failure_code: p.failure_code,
  failure_message: p.failure_message,
  fee: { amount: kes(p.fee_cents), refunded: p.status === "failed" },
  metadata: p.metadata ?? {},
  livemode: p.mode === "live",
  created_at: p.created_at,
  completed_at: p.completed_at,
});

export type PayoutInput = { phone: string; amount: number; reference: string; reason: string; metadata?: Record<string, unknown> };

function guard(merchant: Merchant, mode: Mode, purpose: Payout["purpose"]) {
  if (mode === "live" && purpose === "payout" && merchant.verification_status !== "approved")
    throw new ApiError(403, "payouts_not_enabled", "B2C needs a verified account. Complete Verification in the dashboard.", "permission_error");
}

/** Reserves amount and fee for one payout inside an open transaction. */
async function reserve(q: Q, merchant: Merchant, mode: Mode, input: PayoutInput, purpose: Payout["purpose"], batchId: string | null) {
  const fee = b2cFeeCents(input.amount);
  if (fee === null || !Number.isInteger(input.amount)) throw new ApiError(400, "invalid_amount", "Payouts run from KES 10 to KES 250,000 in whole shillings.");
  const cents = input.amount * 100;
  const b = await lock(q, merchant.id, mode);
  if (b.float.available < cents) throw new ApiError(409, "insufficient_float", `Payout float is KES ${kes(b.float.available).toLocaleString()} and this payout needs KES ${input.amount.toLocaleString()}.`, "balance_error");
  const feeAccount = feeSource(b, fee, merchant.auto_cover, cents);
  await hold(q, merchant.id, mode, "float", cents);
  await hold(q, merchant.id, mode, feeAccount, fee);
  if (feeAccount === "fee") await lowBalanceCheck(q, merchant.id, mode, b.fee.available);
  const id = newId("po");
  await q.query(
    `insert into payouts (id, merchant_id, mode, purpose, batch_id, phone, amount, reference, reason, fee_cents, fee_account, originator_conversation_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, merchant.id, mode, purpose, batchId, input.phone, input.amount, input.reference, input.reason, fee, feeAccount, `SP-${id}`, JSON.stringify(input.metadata ?? {})],
  );
  return id;
}

export async function createPayout(app: App, merchant: Merchant, mode: Mode, input: PayoutInput, purpose: Payout["purpose"] = "payout") {
  guard(merchant, mode, purpose);
  if (!driverFor(app, mode)) throw new ApiError(503, "live_not_configured", "Live M-Pesa is not configured on this server yet.", "api_error");
  const id = await app.db.tx((q) => reserve(q, merchant, mode, input, purpose, null));
  await dispatch(app, id);
  return (await one<Payout>(app.db, `select * from payouts where id = $1`, [id]))!;
}

/**
 * Bulk payouts: the whole batch is checked against the float in one
 * transaction, so a batch is either fully reserved or not at all. Items are
 * sent by the worker at a steady pace.
 */
export async function createBatch(app: App, merchant: Merchant, mode: Mode, reference: string | null, items: PayoutInput[]) {
  guard(merchant, mode, "payout");
  if (!items.length || items.length > 1000) throw new ApiError(400, "invalid_batch", "A batch holds 1 to 1,000 payouts.");
  const batchId = newId("bat");
  const total = items.reduce((a, i) => a + i.amount, 0);
  await app.db.tx(async (q) => {
    await q.query(`insert into payout_batches (id, merchant_id, mode, reference, count, total) values ($1,$2,$3,$4,$5,$6)`, [batchId, merchant.id, mode, reference, items.length, total]);
    for (const [i, item] of items.entries()) {
      try {
        await reserve(q, merchant, mode, item, "payout", batchId);
      } catch (e) {
        if (e instanceof ApiError) throw new ApiError(e.status, e.code, `Item ${i + 1}: ${e.message} Nothing was sent.`, e.type, { index: i });
        throw e;
      }
    }
  });
  return { id: batchId, object: "payout_batch", reference, count: items.length, total, livemode: mode === "live" };
}

function commandFor(reason: string): B2cRequest["commandId"] {
  return reason === "salary" ? "SalaryPayment" : reason === "promotion" ? "PromotionPayment" : "BusinessPayment";
}

/** Hands one queued payout to M-Pesa. */
export async function dispatch(app: App, payoutId: string) {
  const claimed = await app.db.tx(async (q) => {
    const p = await one<Payout>(q, `select * from payouts where id = $1 for update`, [payoutId]);
    if (!p || p.status !== "queued") return null;
    await q.query(`update payouts set status = 'processing', updated_at = now() where id = $1`, [p.id]);
    return p;
  });
  if (!claimed) return;
  const driver = driverFor(app, claimed.mode);
  try {
    if (!driver) throw new MpesaRejected("live_not_configured", "Live M-Pesa is not configured");
    const base = `${app.cfg.publicUrl}/callbacks/daraja`;
    const res = await driver.b2c({
      originatorConversationId: claimed.originator_conversation_id!,
      amount: Number(claimed.amount),
      phone: claimed.phone,
      commandId: commandFor(claimed.reason),
      remarks: claimed.reference,
      occasion: claimed.reason,
      resultUrl: `${base}/b2c-result/${app.cfg.callbackToken}`,
      timeoutUrl: `${base}/b2c-timeout/${app.cfg.callbackToken}`,
    });
    await app.db.query(`update payouts set conversation_id = $2, updated_at = now() where id = $1`, [claimed.id, res.conversationId]);
  } catch (e) {
    const code = e instanceof MpesaRejected ? e.code : "mpesa_unavailable";
    await settle(app, claimed.id, { ok: false, code, message: e instanceof Error ? e.message : "M-Pesa did not accept the payout" });
  }
}

export async function handleB2cResult(app: App, r: B2cResult, kind: "result" | "timeout" = "result") {
  await app.db.query(`insert into daraja_callbacks (kind, payload, ref) values ($1, $2, $3)`, [`b2c_${kind}`, JSON.stringify(r), r.originatorConversationId]);
  const p = await one<Payout>(app.db, `select * from payouts where originator_conversation_id = $1`, [r.originatorConversationId]);
  if (!p || TERMINAL.has(p.status)) return p;
  const ok = kind === "result" && r.resultCode === "0";
  return settle(app, p.id, ok ? { ok, receipt: r.receipt, name: r.recipientName } : { ok, code: r.resultCode, message: r.resultDesc });
}

/** Delivered: amount and fee leave. Failed: both go back. Exactly once. */
async function settle(app: App, payoutId: string, o: { ok: boolean; code?: string; message?: string; receipt?: string; name?: string }) {
  return app.db.tx(async (q) => {
    const p = await one<Payout>(q, `select * from payouts where id = $1 for update`, [payoutId]);
    if (!p || TERMINAL.has(p.status)) return p;
    await lock(q, p.merchant_id, p.mode);
    const cents = Number(p.amount) * 100;
    if (o.ok) {
      await capture(q, p.merchant_id, p.mode, "float", cents, p.purpose === "withdrawal" ? "withdrawal" : "payout", p.id);
      await capture(q, p.merchant_id, p.mode, p.fee_account, Number(p.fee_cents), "fee", p.id);
    } else {
      await release(q, p.merchant_id, p.mode, "float", cents);
      await release(q, p.merchant_id, p.mode, p.fee_account, Number(p.fee_cents));
    }
    await q.query(
      `update payouts set status = $2, mpesa_receipt = $3, recipient_name = $4, failure_code = $5, failure_message = $6, updated_at = now(), completed_at = now() where id = $1`,
      [p.id, o.ok ? "succeeded" : "failed", o.receipt ?? null, o.name ?? null, o.ok ? null : o.code ?? null, o.ok ? null : o.message ?? null],
    );
    const done = (await one<Payout>(q, `select * from payouts where id = $1`, [p.id]))!;
    if (p.purpose === "payout") await emit(q, p.merchant_id, p.mode, o.ok ? "payout.succeeded" : "payout.failed", presentPayout(done));
    return done;
  });
}

/** Worker step: sends queued batch items, a few at a time. */
export async function dispatchQueued(app: App, limit = 10) {
  const { rows } = await app.db.query<{ id: string }>(`select id from payouts where status = 'queued' order by created_at limit $1`, [limit]);
  for (const r of rows) await dispatch(app, r.id);
  return rows.length;
}

/**
 * Sandbox payouts left processing by a restart are failed and refunded
 * (test money). Live ones are never auto-refunded: only M-Pesa's answer moves real float.
 */
export async function reconcilePayouts(app: App) {
  const { rows } = await app.db.query<{ id: string }>(
    `select id from payouts where mode = 'test' and status = 'processing' and updated_at < now() - interval '5 minutes' limit 50`,
  );
  for (const r of rows) await settle(app, r.id, { ok: false, code: "timeout", message: "No result from the sandbox" });
}

export async function listPayouts(app: App, merchantId: string, mode: Mode, f: { q?: string; limit?: number; batch?: string; before?: string }) {
  const params: unknown[] = [merchantId, mode];
  let where = `merchant_id = $1 and mode = $2 and purpose = 'payout'`;
  if (f.batch) {
    params.push(f.batch);
    where += ` and batch_id = $${params.length}`;
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    where += ` and (lower(reference) like $${params.length} or phone like $${params.length} or lower(coalesce(recipient_name,'')) like $${params.length} or lower(coalesce(mpesa_receipt,'')) like $${params.length})`;
  }
  if (f.before) {
    params.push(f.before);
    where += ` and created_at < (select created_at from payouts where id = $${params.length})`;
  }
  params.push(Math.min(f.limit ?? 50, 200));
  const { rows } = await app.db.query<Payout>(`select * from payouts where ${where} order by created_at desc limit $${params.length}`, params);
  return rows;
}
