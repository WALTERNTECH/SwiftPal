import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, open, seal } from "../lib.js";
import type { Merchant } from "./accounts.js";

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
  if (merchant.verification_status !== "approved")
    throw new ApiError(403, "verification_required", "Tills and Paybills open once your account is verified.", "permission_error");
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
      // The account behind it is already verified, so the channel is live straight away.
      `insert into channels (id, merchant_id, kind, shortcode, account_number, display_name, is_default, credential_mode, business_shortcode, passkey_enc, status, verified_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now())`,
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

