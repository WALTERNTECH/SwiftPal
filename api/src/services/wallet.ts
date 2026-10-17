import type { Account, Mode } from "../app.js";
import type { Q } from "../db.js";
import { ApiError, kes, newId } from "../lib.js";
import { TEST_FEE_CREDIT_CENTS, TEST_FLOAT_CENTS } from "../pricing.js";

// Two balances per merchant and mode. `held` is money reserved for requests
// still in flight; it is either captured (charged) or released when M-Pesa
// answers. Every capture and credit writes a ledger entry; holds do not,
// because they are not yet movements.

export type Bal = { available: number; held: number };
export type Balances = Record<Account, Bal>;

export async function createBalances(q: Q, merchantId: string) {
  await q.query(
    `insert into balances (merchant_id, mode, account, available_cents) values
     ($1,'test','fee',$2), ($1,'test','float',$3), ($1,'live','fee',0), ($1,'live','float',0)`,
    [merchantId, TEST_FEE_CREDIT_CENTS, TEST_FLOAT_CENTS],
  );
}

/** Locks both balances for this merchant and mode until the transaction ends. */
export async function lock(q: Q, merchantId: string, mode: Mode): Promise<Balances> {
  const { rows } = await q.query<{ account: Account; available_cents: number; held_cents: number }>(
    `select account, available_cents, held_cents from balances where merchant_id = $1 and mode = $2 order by account for update`,
    [merchantId, mode],
  );
  const out = { fee: { available: 0, held: 0 }, float: { available: 0, held: 0 } } as Balances;
  for (const r of rows) out[r.account] = { available: Number(r.available_cents), held: Number(r.held_cents) };
  return out;
}

export async function read(q: Q, merchantId: string, mode: Mode): Promise<Balances> {
  const { rows } = await q.query<{ account: Account; available_cents: number; held_cents: number }>(
    `select account, available_cents, held_cents from balances where merchant_id = $1 and mode = $2`,
    [merchantId, mode],
  );
  const out = { fee: { available: 0, held: 0 }, float: { available: 0, held: 0 } } as Balances;
  for (const r of rows) out[r.account] = { available: Number(r.available_cents), held: Number(r.held_cents) };
  return out;
}

export async function hold(q: Q, merchantId: string, mode: Mode, account: Account, cents: number) {
  if (cents <= 0) return;
  await q.query(
    `update balances set available_cents = available_cents - $4, held_cents = held_cents + $4
     where merchant_id = $1 and mode = $2 and account = $3`,
    [merchantId, mode, account, cents],
  );
}

/** Held money leaves for good: a fee is charged or a payout is delivered. */
export async function capture(q: Q, merchantId: string, mode: Mode, account: Account, cents: number, kind: string, ref: string) {
  if (cents <= 0) return;
  await q.query(`update balances set held_cents = held_cents - $4 where merchant_id = $1 and mode = $2 and account = $3`, [merchantId, mode, account, cents]);
  await ledger(q, merchantId, mode, account, kind, -cents, ref);
}

/** Held money goes back to available: the request failed or was cancelled. */
export async function release(q: Q, merchantId: string, mode: Mode, account: Account, cents: number) {
  if (cents <= 0) return;
  await q.query(
    `update balances set held_cents = held_cents - $4, available_cents = available_cents + $4
     where merchant_id = $1 and mode = $2 and account = $3`,
    [merchantId, mode, account, cents],
  );
}

export async function credit(q: Q, merchantId: string, mode: Mode, account: Account, cents: number, kind: string, ref: string | null) {
  if (cents <= 0) return;
  await q.query(`update balances set available_cents = available_cents + $4 where merchant_id = $1 and mode = $2 and account = $3`, [merchantId, mode, account, cents]);
  await ledger(q, merchantId, mode, account, kind, cents, ref);
}

async function ledger(q: Q, merchantId: string, mode: Mode, account: Account, kind: string, cents: number, ref: string | null) {
  await q.query(`insert into ledger_entries (id, merchant_id, mode, account, kind, amount_cents, ref) values ($1,$2,$3,$4,$5,$6,$7)`, [
    newId("led"),
    merchantId,
    mode,
    account,
    kind,
    cents,
    ref,
  ]);
}

/**
 * Reserves a fee. Fee credit first; payout float only if the merchant
 * turned on auto-cover. Returns which balance paid.
 */
export function feeSource(b: Balances, cents: number, autoCover: boolean, alsoFromFloat = 0): Account {
  if (b.fee.available >= cents) return "fee";
  if (autoCover && b.float.available >= cents + alsoFromFloat) return "float";
  throw new ApiError(
    402,
    "insufficient_fee_credit",
    `Fee credit is KES ${kes(b.fee.available).toFixed(2)} and this request needs KES ${kes(cents).toFixed(2)} held. Top up or turn on auto-cover.`,
    "balance_error",
  );
}

export const present = (b: Balances) => ({
  fee_credit: { available: kes(b.fee.available), held: kes(b.fee.held) },
  payout_float: { available: kes(b.float.available), held: kes(b.float.held) },
  currency: "KES",
});
