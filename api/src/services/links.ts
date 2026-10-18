import { randomInt } from "node:crypto";
import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, newId, normalisePhone } from "../lib.js";
import { limit } from "../limits.js";
import { assertActive, getMerchant, type Merchant } from "./accounts.js";
import { createStk, presentPayment, type Payment } from "./payments.js";
import { record, type Ctx } from "./security.js";

// Payment links: a page anyone can pay from with M-Pesa, for merchants who
// sell on WhatsApp or Instagram and don't write code. The customer enters
// their number, gets the prompt, and the money lands in the merchant's Till
// or Paybill like any other payment, webhooks included.

export type Link = {
  id: string;
  merchant_id: string;
  slug: string;
  title: string;
  description: string | null;
  amount: number | null;
  reference: string;
  channel_id: string | null;
  active: boolean;
  created_at: string;
};

const SLUG = "abcdefghjkmnpqrstuvwxyz23456789";
const MERCHANT_SIDE = new Set([
  "live_not_configured",
  "payments_paused",
  "insufficient_fee_credit",
  "no_payment_channels",
  "channel_unverified",
  "channel_not_found",
  "account_not_live",
  "account_suspended",
]);
const newSlug = () => Array.from({ length: 8 }, () => SLUG[randomInt(0, SLUG.length)]).join("");

const present = (app: App, l: Link & { paid_count?: number; paid_total?: number }) => ({
  id: l.id,
  url: `${app.cfg.webUrl}/pay/${l.slug}`,
  slug: l.slug,
  title: l.title,
  description: l.description,
  amount: l.amount === null ? null : Number(l.amount),
  reference: l.reference,
  channel: l.channel_id,
  active: l.active,
  paid_count: Number(l.paid_count ?? 0),
  paid_total: Number(l.paid_total ?? 0),
  created_at: l.created_at,
});

export type LinkInput = { title: string; description?: string | null; amount?: number | null; reference?: string; channel?: string | null };

export async function create(app: App, merchant: Merchant, userId: string, input: LinkInput, ctx: Ctx) {
  assertActive(merchant);
  if (!merchant.live_enabled) throw new ApiError(403, "account_not_live", "Payment links work once your account is verified.", "permission_error");
  if (input.channel && !(await one(app.db, `select 1 from channels where id = $1 and merchant_id = $2 and removed_at is null`, [input.channel, merchant.id])))
    throw new ApiError(400, "channel_not_found", "Pick one of your Tills or Paybills.");
  const id = newId("plink");
  for (let tries = 0; ; tries++) {
    const slug = newSlug();
    const reference = (input.reference?.trim() || slug.toUpperCase()).slice(0, 12);
    try {
      await app.db.tx(async (q) => {
        await q.query(
          `insert into payment_links (id, merchant_id, slug, title, description, amount, reference, channel_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, merchant.id, slug, input.title.trim(), input.description?.trim() || null, input.amount ?? null, reference, input.channel ?? null, userId],
        );
        await record(q, merchant.id, userId, "link_created", { link: id, title: input.title.trim(), amount: input.amount ?? null }, ctx);
      });
      break;
    } catch (e) {
      // A slug collision is astronomically rare; anything else is real.
      if (tries < 3 && /payment_links_slug|duplicate key/.test((e as Error).message)) continue;
      throw e;
    }
  }
  return get(app, merchant.id, id);
}

export async function get(app: App, merchantId: string, id: string) {
  const { rows } = await app.db.query<Link & { paid_count: number; paid_total: number }>(
    `select l.*, (select count(*)::int from payments p where p.link_id = l.id and p.status = 'succeeded') as paid_count,
            (select coalesce(sum(amount), 0) from payments p where p.link_id = l.id and p.status = 'succeeded') as paid_total
     from payment_links l where l.id = $1 and l.merchant_id = $2`,
    [id, merchantId],
  );
  if (!rows[0]) throw new ApiError(404, "not_found", "No such payment link.", "not_found");
  return present(app, rows[0]);
}

export async function list(app: App, merchantId: string) {
  const { rows } = await app.db.query<Link & { paid_count: number; paid_total: number }>(
    `select l.*, coalesce(s.n, 0) as paid_count, coalesce(s.total, 0) as paid_total
     from payment_links l left join (select link_id, count(*)::int as n, sum(amount) as total from payments where merchant_id = $1 and status = 'succeeded' and link_id is not null group by link_id) s on s.link_id = l.id
     where l.merchant_id = $1 order by l.created_at desc limit 200`,
    [merchantId],
  );
  return rows.map((l) => present(app, l));
}

export async function update(app: App, merchantId: string, userId: string, id: string, patch: { active?: boolean; title?: string; description?: string | null }, ctx: Ctx) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query(
      `update payment_links set active = coalesce($3, active), title = coalesce($4, title), description = case when $5::boolean then $6 else description end
       where id = $1 and merchant_id = $2 returning id`,
      [id, merchantId, patch.active ?? null, patch.title?.trim() || null, patch.description !== undefined, patch.description?.trim() || null],
    );
    if (!rows.length) throw new ApiError(404, "not_found", "No such payment link.", "not_found");
    if (patch.active !== undefined) await record(q, merchantId, userId, patch.active ? "link_enabled" : "link_disabled", { link: id }, ctx);
  });
  return get(app, merchantId, id);
}

// ---------- the public page ----------

async function openLink(app: App, slug: string) {
  if (!/^[a-z0-9]{6,16}$/.test(slug)) return null;
  const l = await one<Link>(app.db, `select * from payment_links where slug = $1`, [slug]);
  if (!l) return null;
  const m = await getMerchant(app.db, l.merchant_id);
  return { link: l, merchant: m };
}

/** What the payer sees. A paused link or account says so instead of taking money. */
export async function publicView(app: App, slug: string) {
  const o = await openLink(app, slug);
  if (!o) throw new ApiError(404, "link_not_found", "This payment link doesn't exist.", "not_found");
  const { link, merchant } = o;
  const open = link.active && !merchant.suspended_at && merchant.live_enabled;
  return {
    title: link.title,
    description: link.description,
    amount: link.amount === null ? null : Number(link.amount),
    business: merchant.name,
    verified: merchant.verification_status === "approved",
    open,
  };
}

/**
 * Sends the prompt. Each address and each phone number is capped, so a link
 * can't be used to flood strangers with M-Pesa prompts.
 */
export async function pay(app: App, slug: string, input: { phone: string; amount?: number }, ip: string) {
  limit(`link-pay:ip:${ip}`, 10, 10 * 60_000, "Too many payment attempts from here. Try again in a few minutes.");
  const o = await openLink(app, slug);
  if (!o) throw new ApiError(404, "link_not_found", "This payment link doesn't exist.", "not_found");
  const { link, merchant } = o;
  if (!link.active || merchant.suspended_at || !merchant.live_enabled) throw new ApiError(410, "link_closed", "This payment link isn't taking payments right now.");
  const phone = normalisePhone(input.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Enter a Safaricom number, e.g. 0712 345 678.");
  const amount = link.amount === null ? input.amount : Number(link.amount);
  if (!amount || !Number.isInteger(amount) || amount < 1 || amount > 250_000) throw new ApiError(400, "invalid_amount", "Enter an amount between KES 1 and KES 250,000.");
  limit(`link-pay:phone:${phone}`, 3, 10 * 60_000, "This number was sent several prompts just now. Wait a few minutes, then try again.");
  limit(`link-pay:phone-day:${phone}`, 12, 24 * 3600_000, "This number has had too many prompts today.");
  try {
    assertActive(merchant);
    const p = await createStk(
      app,
      merchant,
      "live",
      { phone, amount, reference: link.reference, description: "Payment", channel: link.channel_id ?? undefined, metadata: { payment_link: link.id, source: "payment_link" } },
      { linkId: link.id },
    );
    return { payment: p.id, status: presentPayment(p).status };
  } catch (e) {
    // The merchant's own setup (fee credit, channels, a pause) is theirs to fix; the payer just learns it isn't working.
    if (e instanceof ApiError && MERCHANT_SIDE.has(e.code))
      throw new ApiError(503, "link_unavailable", "This business can't take M-Pesa payments right now. Try again later or contact them.", "api_error");
    throw e;
  }
}

/** Only payments made through a link are visible here, and only their outcome. */
export async function publicStatus(app: App, paymentId: string) {
  const p = await one<Payment & { title: string; business: string }>(
    app.db,
    `select p.*, l.title, m.name as business from payments p join payment_links l on l.id = p.link_id join merchants m on m.id = p.merchant_id where p.id = $1`,
    [paymentId],
  );
  if (!p) throw new ApiError(404, "not_found", "No such payment.", "not_found");
  const view = presentPayment(p);
  return {
    status: view.status,
    amount: view.amount,
    title: p.title,
    business: p.business,
    mpesa_receipt: view.mpesa_receipt,
    message: view.status === "succeeded" ? null : view.failure_message,
    completed_at: view.completed_at,
  };
}
