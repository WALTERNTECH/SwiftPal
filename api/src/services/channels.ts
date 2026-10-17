import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, open, seal } from "../lib.js";
import { STARTER_CREDIT_CENTS } from "../pricing.js";
import { getMerchant, insertKey, type Merchant, type User } from "./accounts.js";
import { createStk } from "./payments.js";
import { credit } from "./wallet.js";

export type Channel = {
  id: string;
  merchant_id: string;
  kind: "till" | "paybill";
  shortcode: string;
  account_number: string | null;
  display_name: string;
  status: "unverified" | "verifying" | "verified";
  is_default: boolean;
  credential_mode: "platform" | "linked";
  business_shortcode: string | null;
  passkey_enc: string | null;
  verify_payment_id: string | null;
  created_at: string;
  verified_at: string | null;
};

export const presentChannel = (c: Channel) => ({
  id: c.id,
  object: "channel",
  kind: c.kind,
  shortcode: c.shortcode,
  account_number: c.account_number,
  display_name: c.display_name,
  status: c.status,
  is_default: c.is_default,
  credential_mode: c.credential_mode,
  created_at: c.created_at,
  verified_at: c.verified_at,
});

export async function listChannels(app: App, merchantId: string) {
  const { rows } = await app.db.query<Channel>(`select * from channels where merchant_id = $1 and removed_at is null order by created_at`, [merchantId]);
  return rows;
}

export async function addChannel(
  app: App,
  merchant: Merchant,
  input: { kind: "till" | "paybill"; shortcode: string; accountNumber?: string; displayName: string; businessShortcode?: string; passkey?: string },
) {
  if (!/^\d{5,7}$/.test(input.shortcode)) throw new ApiError(400, "invalid_shortcode", "A till or paybill number is 5 to 7 digits.");
  const account = input.accountNumber?.trim();
  if (input.kind === "paybill" && !account) throw new ApiError(400, "account_number_required", "Enter the account number for this paybill.");
  if (account && account.length > 20) throw new ApiError(400, "invalid_account_number", "Account numbers are at most 20 characters.");
  if (!input.displayName.trim()) throw new ApiError(400, "invalid_name", "Enter the name registered to this shortcode.");
  const linked = !!(input.passkey && input.businessShortcode);
  if (input.passkey && !/^\d{5,7}$/.test(input.businessShortcode ?? "")) throw new ApiError(400, "invalid_business_shortcode", "Linked channels need the shortcode that owns the passkey.");

  return app.db.tx(async (q) => {
    if (await one(q, `select 1 from channels where merchant_id = $1 and shortcode = $2 and removed_at is null`, [merchant.id, input.shortcode]))
      throw new ApiError(409, "channel_exists", "That number is already added.");
    const first = !(await one(q, `select 1 from channels where merchant_id = $1 and removed_at is null`, [merchant.id]));
    const id = `${input.kind}_${input.shortcode}`;
    await q.query(`update channels set id = id || '_' || extract(epoch from removed_at)::bigint where id = $1 and removed_at is not null`, [id]);
    await q.query(
      `insert into channels (id, merchant_id, kind, shortcode, account_number, display_name, is_default, credential_mode, business_shortcode, passkey_enc)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        merchant.id,
        input.kind,
        input.shortcode,
        input.kind === "paybill" ? account : null,
        input.displayName.trim().toUpperCase(),
        first,
        linked ? "linked" : "platform",
        linked ? input.businessShortcode : null,
        linked ? seal(app.cfg.masterKey, input.passkey!) : null,
      ],
    );
    return (await one<Channel>(q, `select * from channels where id = $1`, [id]))!;
  });
}

/** Sends KES 1 from the owner's phone into the channel. Free: STK under KES 10 costs nothing. */
export async function startVerification(app: App, merchant: Merchant, user: User, channelId: string) {
  const ch = await one<Channel>(app.db, `select * from channels where id = $1 and merchant_id = $2 and removed_at is null`, [channelId, merchant.id]);
  if (!ch) throw new ApiError(404, "not_found", "No such channel.", "not_found");
  if (ch.status === "verified") return { channel: ch, payment: null };
  // Without live Daraja credentials the prompt is simulated, so the flow still works end to end.
  const mode = app.mpesa.live ? "live" : "test";
  const payment = await createStk(app, merchant, mode, { phone: user.phone, amount: 1, reference: "VERIFY", description: "Verify" }, { purpose: "channel_verify", channel: ch });
  await app.db.query(`update channels set status = 'verifying', verify_payment_id = $2 where id = $1`, [ch.id, payment.id]);
  return { channel: { ...ch, status: "verifying" as const, verify_payment_id: payment.id }, payment };
}

/**
 * The owner confirms the prompt showed their business name. Turns on live
 * mode, adds the starter credit once, and issues the first live key.
 */
export async function confirmVerification(app: App, merchantId: string, channelId: string) {
  return app.db.tx(async (q) => {
    const ch = await one<Channel>(q, `select * from channels where id = $1 and merchant_id = $2 and removed_at is null for update`, [channelId, merchantId]);
    if (!ch) throw new ApiError(404, "not_found", "No such channel.", "not_found");
    if (ch.status === "verified") return { channel: ch, liveKey: null };
    const p = ch.verify_payment_id ? await one<{ status: string }>(q, `select status from payments where id = $1`, [ch.verify_payment_id]) : null;
    if (!p || p.status !== "succeeded") throw new ApiError(409, "verification_incomplete", "The KES 1 prompt hasn't been paid yet.");
    await q.query(`update channels set status = 'verified', verified_at = now() where id = $1`, [ch.id]);
    const m = await getMerchant(q, merchantId);
    if (!m.starter_credit_given) {
      await credit(q, merchantId, "live", "fee", STARTER_CREDIT_CENTS, "starter_credit", ch.id);
      await q.query(`update merchants set starter_credit_given = true where id = $1`, [merchantId]);
    }
    await q.query(`update merchants set live_enabled = true where id = $1`, [merchantId]);
    let liveKey: string | null = null;
    if (!(await one(q, `select 1 from api_keys where merchant_id = $1 and mode = 'live' and revoked_at is null`, [merchantId]))) {
      const scopes = m.verification_status === "approved" ? ["payments:write", "payouts:write", "read"] : ["payments:write", "read"];
      liveKey = (await insertKey(app, q, merchantId, "live", "Default live key", scopes)).secret;
    }
    return { channel: (await one<Channel>(q, `select * from channels where id = $1`, [ch.id]))!, liveKey };
  });
}

export async function setDefaultChannel(app: App, merchantId: string, channelId: string) {
  await app.db.tx(async (q) => {
    const ch = await one(q, `select 1 from channels where id = $1 and merchant_id = $2 and removed_at is null`, [channelId, merchantId]);
    if (!ch) throw new ApiError(404, "not_found", "No such channel.", "not_found");
    await q.query(`update channels set is_default = (id = $2) where merchant_id = $1 and removed_at is null`, [merchantId, channelId]);
  });
}

export async function removeChannel(app: App, merchantId: string, channelId: string) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query<{ is_default: boolean }>(
      `update channels set removed_at = now(), is_default = false where id = $1 and merchant_id = $2 and removed_at is null returning is_default`,
      [channelId, merchantId],
    );
    if (!rows.length) throw new ApiError(404, "not_found", "No such channel.", "not_found");
    await q.query(
      `update channels set is_default = true where id = (select id from channels where merchant_id = $1 and removed_at is null order by created_at limit 1)
       and not exists (select 1 from channels where merchant_id = $1 and removed_at is null and is_default)`,
      [merchantId],
    );
  });
}

/** Daraja parameters for a prompt into this channel. */
export function stkTarget(app: App, ch: Channel) {
  const d = app.cfg.daraja;
  const linked = ch.credential_mode === "linked" && ch.passkey_enc && ch.business_shortcode;
  return {
    businessShortCode: linked ? ch.business_shortcode! : d?.stkShortcode ?? "",
    passkey: linked ? open(app.cfg.masterKey, ch.passkey_enc!) : d?.stkPasskey ?? "",
    partyB: ch.shortcode,
    transactionType: ch.kind === "till" ? ("CustomerBuyGoodsOnline" as const) : ("CustomerPayBillOnline" as const),
  };
}

export const sandboxChannel = (merchantId: string): Channel => ({
  id: "sandbox_till",
  merchant_id: merchantId,
  kind: "till",
  shortcode: "000000",
  account_number: null,
  display_name: "SANDBOX TILL",
  status: "verified",
  is_default: true,
  credential_mode: "platform",
  business_shortcode: null,
  passkey_enc: null,
  verify_payment_id: null,
  created_at: new Date(0).toISOString(),
  verified_at: null,
});

