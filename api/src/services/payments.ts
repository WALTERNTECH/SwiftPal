import { driverFor, type Account, type App, type Mode } from "../app.js";
import { one } from "../db.js";
import { ApiError, kes, newId } from "../lib.js";
import { stkOutcome } from "../mpesa/callbacks.js";
import { MpesaRejected, type StkResult } from "../mpesa/types.js";
import { stkFeeCents } from "../pricing.js";
import type { Merchant } from "./accounts.js";
import { sandboxChannel, stkTarget, type Channel } from "./channels.js";
import { emit } from "./events.js";
import { capture, credit, feeSource, hold, lock, read, release } from "./wallet.js";

export type Payment = {
  id: string;
  merchant_id: string;
  mode: Mode;
  purpose: "charge" | "topup" | "channel_verify";
  channel_id: string | null;
  phone: string;
  amount: number;
  reference: string;
  description: string | null;
  status: "pending" | "confirming" | "succeeded" | "failed" | "cancelled" | "expired";
  fee_cents: number;
  fee_account: Account | null;
  fee_charged: boolean;
  topup_account: Account | null;
  mpesa_receipt: string | null;
  failure_code: string | null;
  failure_message: string | null;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "expired"]);

export const presentPayment = (p: Payment) => ({
  id: p.id,
  object: "payment",
  status: p.status === "confirming" ? "pending" : p.status,
  amount: Number(p.amount),
  currency: "KES",
  phone: p.phone,
  reference: p.reference,
  description: p.description,
  channel: p.channel_id,
  mpesa_receipt: p.mpesa_receipt,
  failure_code: p.failure_code,
  failure_message: p.failure_message,
  fee: { amount: kes(p.fee_cents), charged: p.fee_charged },
  metadata: p.metadata ?? {},
  livemode: p.mode === "live",
  created_at: p.created_at,
  completed_at: p.completed_at,
});

export type StkInput = { phone: string; amount: number; reference: string; description?: string; channel?: string; metadata?: Record<string, unknown> };

/**
 * Sends an STK Push. The fee is held before the prompt goes out and settled
 * when M-Pesa answers: charged on success, released on anything else.
 */
export async function createStk(
  app: App,
  merchant: Merchant,
  mode: Mode,
  input: StkInput,
  opts: { purpose?: Payment["purpose"]; channel?: Channel; topupAccount?: Account } = {},
): Promise<Payment> {
  const purpose = opts.purpose ?? "charge";
  const driver = driverFor(app, mode);
  if (!driver) throw new ApiError(503, "live_not_configured", "Live M-Pesa is not configured on this server yet.", "api_error");
  if (mode === "live" && purpose === "charge" && !merchant.live_enabled)
    throw new ApiError(403, "account_not_live", "Verify a Till or Paybill before sending live prompts.", "permission_error");

  // Resolve where the money goes.
  let channel: Channel | null = opts.channel ?? null;
  if (purpose === "charge" && !channel) {
    channel = input.channel
      ? await one<Channel>(app.db, `select * from channels where merchant_id = $1 and id = $2 and removed_at is null`, [merchant.id, input.channel])
      : await one<Channel>(app.db, `select * from channels where merchant_id = $1 and removed_at is null and is_default`, [merchant.id]);
    if (input.channel && !channel) throw new ApiError(400, "channel_not_found", `No channel ${input.channel} on this account.`);
    if (!channel) {
      if (mode === "live") throw new ApiError(400, "no_payment_channels", "Add and verify a Till or Paybill first.");
      channel = sandboxChannel(merchant.id);
    }
    if (mode === "live" && channel.status !== "verified") throw new ApiError(422, "channel_unverified", "This channel hasn't completed its KES 1 verification.");
  }

  const fee = purpose === "charge" ? stkFeeCents(input.amount) ?? 0 : 0;
  const id = newId("pay");
  await app.db.tx(async (q) => {
    let feeAccount: Account | null = null;
    if (fee > 0) {
      const b = await lock(q, merchant.id, mode);
      feeAccount = feeSource(b, fee, merchant.auto_cover);
      await hold(q, merchant.id, mode, feeAccount, fee);
      if (feeAccount === "fee") await lowBalanceCheck(q, merchant.id, mode, b.fee.available);
    }
    await q.query(
      `insert into payments (id, merchant_id, mode, purpose, channel_id, phone, amount, reference, description, fee_cents, fee_account, topup_account, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, merchant.id, mode, purpose, channel?.id ?? null, input.phone, input.amount, input.reference, input.description ?? null, fee, feeAccount, opts.topupAccount ?? null, JSON.stringify(input.metadata ?? {})],
    );
  });

  // Daraja parameters. Top-ups pay SwiftPal's own paybill against the merchant's account code.
  const d = app.cfg.daraja;
  const target =
    purpose === "topup"
      ? { businessShortCode: d?.stkShortcode ?? "", passkey: d?.stkPasskey ?? "", partyB: d?.stkShortcode ?? "", transactionType: "CustomerPayBillOnline" as const }
      : stkTarget(app, channel!);
  const accountReference =
    purpose === "topup" ? merchant.account_code : channel?.kind === "paybill" && channel.account_number ? channel.account_number : input.reference;

  try {
    const res = await driver.stkPush({
      ...target,
      amount: input.amount,
      phone: input.phone,
      accountReference,
      description: input.description || (purpose === "topup" ? "Top up" : "Payment"),
      callbackUrl: `${app.cfg.publicUrl}/callbacks/daraja/stk/${app.cfg.callbackToken}`,
    });
    await app.db.query(`update payments set merchant_request_id = $2, checkout_request_id = $3, updated_at = now() where id = $1`, [id, res.merchantRequestId, res.checkoutRequestId]);
  } catch (e) {
    const code = e instanceof MpesaRejected ? e.code : "mpesa_unavailable";
    const msg = e instanceof Error ? e.message : "M-Pesa did not accept the request";
    await finalize(app, id, { status: "failed", code, message: msg });
    throw new ApiError(502, e instanceof MpesaRejected && !e.retryable ? "mpesa_rejected" : "mpesa_unavailable", `M-Pesa rejected the request: ${msg}`, "mpesa_error", {
      payment_id: id,
      mpesa_code: code,
    });
  }
  return (await getPayment(app, merchant.id, id))!;
}

export async function getPayment(app: App, merchantId: string, id: string) {
  return one<Payment>(app.db, `select * from payments where id = $1 and merchant_id = $2`, [id, merchantId]);
}

/** A callback (or a query) told us how a prompt ended. Safe to call twice. */
export async function handleStkResult(app: App, r: StkResult, source: "callback" | "query" = "callback") {
  if (source === "callback") {
    await app.db.query(`insert into daraja_callbacks (kind, payload, ref) values ('stk', $1, $2)`, [JSON.stringify(r), r.checkoutRequestId]);
  }
  const p = await one<Payment>(app.db, `select * from payments where checkout_request_id = $1`, [r.checkoutRequestId]);
  if (!p || TERMINAL.has(p.status)) return p;

  // Safaricom signs nothing. Before trusting a success that would let a merchant
  // ship goods, ask Daraja ourselves.
  if (r.resultCode === "0" && source === "callback" && p.mode === "live" && app.cfg.daraja?.confirmStk && app.mpesa.live?.name === "daraja") {
    await app.db.query(`update payments set status = 'confirming', updated_at = now() where id = $1 and status = 'pending'`, [p.id]);
    const confirmed = await confirmByQuery(app, { ...p, status: "confirming" }).catch(() => null);
    if (confirmed === null) return p; // reconciler will retry
    if (confirmed.resultCode !== "0") return finalize(app, p.id, { status: stkOutcome(confirmed.resultCode).status, code: confirmed.resultCode, message: confirmed.resultDesc });
  }
  const o = stkOutcome(r.resultCode);
  return finalize(app, p.id, { status: o.status, code: r.resultCode, message: o.status === "succeeded" ? null : o.message || r.resultDesc, receipt: r.receipt });
}

async function confirmByQuery(app: App, p: Payment) {
  const driver = driverFor(app, p.mode);
  if (!driver || !p.checkout_request_id) return null;
  let target = { businessShortCode: app.cfg.daraja?.stkShortcode ?? "", passkey: app.cfg.daraja?.stkPasskey ?? "" };
  if (p.purpose !== "topup" && p.channel_id) {
    const ch = await one<Channel>(app.db, `select * from channels where id = $1`, [p.channel_id]);
    if (ch) target = stkTarget(app, ch);
  }
  const res = await driver.stkQuery({ ...target, checkoutRequestId: p.checkout_request_id });
  return res.resultCode === null ? null : { resultCode: res.resultCode, resultDesc: res.resultDesc };
}

/** Moves a payment to a terminal state and settles its money, exactly once. */
export async function finalize(
  app: App,
  paymentId: string,
  o: { status: "succeeded" | "failed" | "cancelled" | "expired"; code?: string | null; message?: string | null; receipt?: string | null },
) {
  return app.db.tx(async (q) => {
    const p = await one<Payment>(q, `select * from payments where id = $1 for update`, [paymentId]);
    if (!p || TERMINAL.has(p.status)) return p;
    const ok = o.status === "succeeded";
    if (p.fee_cents > 0 || p.purpose === "topup") await lock(q, p.merchant_id, p.mode);
    if (p.fee_cents > 0 && p.fee_account) {
      if (ok) await capture(q, p.merchant_id, p.mode, p.fee_account, p.fee_cents, "fee", p.id);
      else await release(q, p.merchant_id, p.mode, p.fee_account, p.fee_cents);
    }
    if (ok && p.purpose === "topup" && p.topup_account) {
      await credit(q, p.merchant_id, p.mode, p.topup_account, Number(p.amount) * 100, "top_up", o.receipt ?? p.id);
    }
    await q.query(
      `update payments set status = $2, mpesa_receipt = coalesce($3, mpesa_receipt), failure_code = $4, failure_message = $5,
       fee_charged = $6, updated_at = now(), completed_at = now() where id = $1`,
      [p.id, o.status, o.receipt ?? null, ok ? null : o.code ?? null, ok ? null : o.message ?? null, ok && p.fee_cents > 0],
    );
    const done = (await one<Payment>(q, `select * from payments where id = $1`, [p.id]))!;
    if (p.purpose === "charge") await emit(q, p.merchant_id, p.mode, `payment.${o.status}` as never, presentPayment(done));
    if (p.purpose === "topup" && ok) {
      await emit(q, p.merchant_id, p.mode, "wallet.topped_up", { account: p.topup_account, amount: Number(p.amount), mpesa_receipt: o.receipt ?? null });
    }
    if (p.purpose === "channel_verify" && !ok) {
      await q.query(`update channels set status = 'unverified' where verify_payment_id = $1 and status = 'verifying'`, [p.id]);
    }
    return done;
  });
}

export async function lowBalanceCheck(q: Parameters<typeof lock>[0], merchantId: string, mode: Mode, availableBefore: number) {
  const m = await one<{ low_balance_at_cents: number }>(q, `select low_balance_at_cents from merchants where id = $1`, [merchantId]);
  const after = (await read(q, merchantId, mode)).fee.available;
  const t = Number(m?.low_balance_at_cents ?? 0);
  if (t > 0 && availableBefore >= t && after < t) await emit(q, merchantId, mode, "wallet.low_balance", { account: "fee_credit", available: kes(after), threshold: kes(t) });
}

export async function createTopup(app: App, merchant: Merchant, mode: Mode, input: { account: Account; amount: number; phone: string }) {
  if (!Number.isInteger(input.amount) || input.amount < 10 || input.amount > 250_000) throw new ApiError(400, "invalid_amount", "Top up between KES 10 and KES 250,000.");
  return createStk(app, merchant, mode, { phone: input.phone, amount: input.amount, reference: merchant.account_code, description: "Top up" }, { purpose: "topup", topupAccount: input.account });
}

/**
 * Settles prompts whose callback never came. Live ones are asked about with
 * STK Query; anything still open after five minutes is expired.
 */
export async function reconcilePayments(app: App) {
  const { rows } = await app.db.query<Payment>(
    `select * from payments where status in ('pending','confirming') and created_at < now() - interval '75 seconds' order by created_at limit 25`,
  );
  for (const p of rows) {
    const age = Date.now() - new Date(p.created_at).getTime();
    try {
      if (p.mode === "live" && p.checkout_request_id) {
        const r = await confirmByQuery(app, p);
        if (r) {
          const o = stkOutcome(r.resultCode);
          await finalize(app, p.id, { status: o.status, code: r.resultCode, message: o.status === "succeeded" ? null : o.message });
          continue;
        }
      }
      if (age > 5 * 60_000) await finalize(app, p.id, { status: "expired", code: "timeout", message: "No result from M-Pesa within 5 minutes" });
    } catch (e) {
      app.log.warn("reconcile payment failed", p.id, (e as Error).message);
    }
  }
}

export async function listPayments(app: App, merchantId: string, mode: Mode, f: { status?: string; q?: string; limit?: number; before?: string }) {
  const params: unknown[] = [merchantId, mode];
  let where = `merchant_id = $1 and mode = $2 and purpose = 'charge'`;
  if (f.status === "unpaid") where += ` and status in ('failed','cancelled','expired')`;
  else if (f.status === "pending") where += ` and status in ('pending','confirming')`;
  else if (f.status) {
    params.push(f.status);
    where += ` and status = $${params.length}`;
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    where += ` and (lower(reference) like $${params.length} or phone like $${params.length} or lower(coalesce(mpesa_receipt,'')) like $${params.length} or lower(id) like $${params.length})`;
  }
  if (f.before) {
    params.push(f.before);
    where += ` and created_at < (select created_at from payments where id = $${params.length})`;
  }
  params.push(Math.min(f.limit ?? 50, 200));
  const { rows } = await app.db.query<Payment>(`select * from payments where ${where} order by created_at desc limit $${params.length}`, params);
  return rows;
}
