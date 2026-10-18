import type { App } from "../app.js";
import { NAIROBI_TODAY, nairobiDay, one } from "../db.js";
import { ApiError, kes } from "../lib.js";
import { audit, type Admin } from "./admins.js";
import { range } from "./exports.js";
import { record, resetTwoFactor } from "./security.js";

// The console's controls beyond reconciliation: each merchant's risk limits
// and negotiated prices, internal notes, support actions on their people, and
// the reports and risk signals operations work from.

type Actor = Pick<Admin, "id"> | null;
const actorId = (a: Actor) => a?.id ?? null;
const todayStart = NAIROBI_TODAY;

// ---------- limits and pricing ----------

export type Terms = { payout_daily_limit?: number | null; stk_fee?: number | null; b2c_fee_pct?: number | null };

/** Undefined leaves a term alone; null puts it back on the platform default. */
export async function setTerms(app: App, actor: Actor, merchantId: string, t: Terms, ip?: string) {
  const cents = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : Math.round(v * 100));
  const next = { payout_daily_limit_cents: cents(t.payout_daily_limit), stk_fee_cents: cents(t.stk_fee), b2c_fee_pct: t.b2c_fee_pct };
  return app.db.tx(async (q) => {
    const before = await one<{ payout_daily_limit_cents: number | null; stk_fee_cents: number | null; b2c_fee_pct: number | null }>(
      q,
      `select payout_daily_limit_cents, stk_fee_cents, b2c_fee_pct from merchants where id = $1 for update`,
      [merchantId],
    );
    if (!before) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
    const after = {
      payout_daily_limit_cents: next.payout_daily_limit_cents === undefined ? before.payout_daily_limit_cents : next.payout_daily_limit_cents,
      stk_fee_cents: next.stk_fee_cents === undefined ? before.stk_fee_cents : next.stk_fee_cents,
      b2c_fee_pct: next.b2c_fee_pct === undefined ? before.b2c_fee_pct : next.b2c_fee_pct,
    };
    await q.query(`update merchants set payout_daily_limit_cents = $2, stk_fee_cents = $3, b2c_fee_pct = $4 where id = $1`, [
      merchantId,
      after.payout_daily_limit_cents,
      after.stk_fee_cents,
      after.b2c_fee_pct,
    ]);
    const show = (x: typeof before) => ({
      payout_daily_limit: x.payout_daily_limit_cents === null ? "default" : kes(Number(x.payout_daily_limit_cents)),
      stk_fee: x.stk_fee_cents === null ? "standard" : kes(Number(x.stk_fee_cents)),
      b2c_fee_pct: x.b2c_fee_pct ?? "standard",
    });
    await audit(q, actorId(actor), "merchant.terms_changed", { type: "merchant", id: merchantId }, { before: show(before), after: show(after) }, ip);
    return show(after);
  });
}

// ---------- notes ----------

export async function notes(app: App, merchantId: string) {
  const { rows } = await app.db.query(
    `select n.id, n.body, n.created_at, a.name as admin_name from merchant_notes n left join admins a on a.id = n.admin_id where n.merchant_id = $1 order by n.created_at desc limit 100`,
    [merchantId],
  );
  return rows;
}

export async function addNote(app: App, actor: Admin, merchantId: string, body: string) {
  if (!(await one(app.db, `select 1 from merchants where id = $1`, [merchantId]))) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
  await app.db.query(`insert into merchant_notes (merchant_id, admin_id, body) values ($1,$2,$3)`, [merchantId, actor.id, body.trim()]);
  return notes(app, merchantId);
}

// ---------- support actions on a merchant's people ----------

/** For a suspected account takeover: every person on the account must sign in again. */
export async function signOutEveryone(app: App, actor: Actor, merchantId: string, ip?: string) {
  return app.db.tx(async (q) => {
    if (!(await one(q, `select 1 from merchants where id = $1`, [merchantId]))) throw new ApiError(404, "not_found", "No such merchant.", "not_found");
    const { rows } = await q.query(`delete from sessions where user_id in (select id from users where merchant_id = $1) returning token_hash`, [merchantId]);
    await record(q, merchantId, null, "signed_out_by_support", { sessions: rows.length });
    await audit(q, actorId(actor), "merchant.signed_out", { type: "merchant", id: merchantId }, { sessions: rows.length }, ip);
    return { sessions: rows.length };
  });
}

/** After confirming who they are by other means: they set up their authenticator again at next sign-in. */
export async function resetMemberTwoFactor(app: App, actor: Actor, merchantId: string, userId: string, ip?: string) {
  await app.db.tx(async (q) => {
    const u = await one<{ email: string }>(q, `select email from users where id = $1 and merchant_id = $2`, [userId, merchantId]);
    if (!u) throw new ApiError(404, "not_found", "No such person on this account.", "not_found");
    await resetTwoFactor(q, userId);
    await q.query(`delete from sessions where user_id = $1`, [userId]);
    await record(q, merchantId, userId, "two_factor_reset_by_support");
    await audit(q, actorId(actor), "merchant.2fa_reset", { type: "merchant", id: merchantId }, { user: userId, email: u.email }, ip);
  });
}

/** What the console shows about a merchant's people, security and links, alongside ops.merchantDetail. */
export async function merchantExtras(app: App, merchantId: string) {
  const people = (
    await app.db.query(
      `select u.id, u.email, u.phone, u.first_name, u.last_name, u.role, u.totp_enabled_at is not null as two_factor, u.disabled_at, u.created_at,
              (select max(coalesce(s.last_seen_at, s.created_at)) from sessions s where s.user_id = u.id) as last_active_at,
              (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now() and not s.otp_pending) as sessions
       from users u where u.merchant_id = $1 order by (u.role = 'owner') desc, u.created_at`,
      [merchantId],
    )
  ).rows;
  const activity = (
    await app.db.query(
      `select e.kind, e.detail, e.ip, e.created_at, u.email from account_events e left join users u on u.id = e.user_id where e.merchant_id = $1 order by e.created_at desc limit 60`,
      [merchantId],
    )
  ).rows;
  const links = (
    await app.db.query(
      `select l.id, l.slug, l.title, l.amount, l.active, l.created_at, (select count(*)::int from payments p where p.link_id = l.id and p.status = 'succeeded') as paid
       from payment_links l where l.merchant_id = $1 order by l.created_at desc limit 50`,
      [merchantId],
    )
  ).rows.map((l) => ({ ...l, url: `${app.cfg.webUrl}/pay/${l.slug}` }));
  const m = await one<{ payout_daily_limit_cents: number | null; stk_fee_cents: number | null; b2c_fee_pct: number | null }>(
    app.db,
    `select payout_daily_limit_cents, stk_fee_cents, b2c_fee_pct from merchants where id = $1`,
    [merchantId],
  );
  const today = await one<{ sent: number }>(
    app.db,
    `select coalesce(sum(amount), 0) as sent from payouts where merchant_id = $1 and mode = 'live' and status not in ('failed','reversed') and created_at >= ${todayStart}`,
    [merchantId],
  );
  return {
    people,
    activity,
    links,
    notes: await notes(app, merchantId),
    terms: {
      payout_daily_limit: m?.payout_daily_limit_cents === null || m?.payout_daily_limit_cents === undefined ? null : kes(Number(m.payout_daily_limit_cents)),
      default_payout_daily_limit: kes(app.cfg.payoutDailyLimitCents),
      sent_today: Number(today?.sent ?? 0),
      stk_fee: m?.stk_fee_cents === null || m?.stk_fee_cents === undefined ? null : kes(Number(m.stk_fee_cents)),
      b2c_fee_pct: m?.b2c_fee_pct ?? null,
    },
  };
}

// ---------- reports ----------

export async function report(app: App, from?: string, to?: string) {
  const r = range(from, to);
  const day = nairobiDay("created_at");
  const pay = (
    await app.db.query<{ day: string; amount: number; count: number; prompts: number }>(
      `select ${day} as day, coalesce(sum(amount) filter (where status = 'succeeded'), 0) as amount, count(*) filter (where status = 'succeeded')::int as count, count(*)::int as prompts
       from payments where mode = 'live' and purpose = 'charge' and created_at >= $1 and created_at < $2 group by 1`,
      [r.start, r.end],
    )
  ).rows;
  const out = (
    await app.db.query<{ day: string; amount: number; count: number }>(
      `select ${day} as day, coalesce(sum(amount) filter (where status = 'succeeded'), 0) as amount, count(*) filter (where status = 'succeeded')::int as count
       from payouts where mode = 'live' and created_at >= $1 and created_at < $2 group by 1`,
      [r.start, r.end],
    )
  ).rows;
  const fees = (
    await app.db.query<{ day: string; cents: number }>(
      `select ${day} as day, -sum(amount_cents) as cents from ledger_entries where mode = 'live' and kind = 'fee' and created_at >= $1 and created_at < $2 group by 1`,
      [r.start, r.end],
    )
  ).rows;
  const signups = (await app.db.query<{ day: string; n: number }>(`select ${day} as day, count(*)::int as n from merchants where created_at >= $1 and created_at < $2 group by 1`, [r.start, r.end])).rows;

  const days: string[] = [];
  for (let t = new Date(`${r.from}T00:00:00Z`).getTime(); t <= new Date(`${r.to}T00:00:00Z`).getTime(); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const at = <T extends { day: string }>(rows: T[], d: string) => rows.find((x) => x.day === d);
  const series = days.map((d) => ({
    date: d,
    collected: Number(at(pay, d)?.amount ?? 0),
    payments: Number(at(pay, d)?.count ?? 0),
    prompts: Number(at(pay, d)?.prompts ?? 0),
    paid_out: Number(at(out, d)?.amount ?? 0),
    payouts: Number(at(out, d)?.count ?? 0),
    fees: kes(Number(at(fees, d)?.cents ?? 0)),
    signups: Number(at(signups, d)?.n ?? 0),
  }));
  const sum = (k: keyof (typeof series)[number]) => series.reduce((a, s) => a + Number(s[k]), 0);
  const top = (await merchantTotals(app, r)).slice(0, 10);
  return {
    from: r.from,
    to: r.to,
    totals: { collected: sum("collected"), payments: sum("payments"), prompts: sum("prompts"), paid_out: sum("paid_out"), payouts: sum("payouts"), fees: Math.round(sum("fees") * 100) / 100, signups: sum("signups") },
    series,
    top_merchants: top,
  };
}

async function merchantTotals(app: App, r: ReturnType<typeof range>) {
  const { rows } = await app.db.query(
    `select m.id, m.name, m.account_code,
            coalesce(p.amount, 0) as collected, coalesce(p.count, 0) as payments, coalesce(o.amount, 0) as paid_out, coalesce(f.cents, 0) as fee_cents
     from merchants m
     left join (select merchant_id, sum(amount) as amount, count(*)::int as count from payments where mode = 'live' and purpose = 'charge' and status = 'succeeded' and created_at >= $1 and created_at < $2 group by 1) p on p.merchant_id = m.id
     left join (select merchant_id, sum(amount) as amount from payouts where mode = 'live' and status = 'succeeded' and created_at >= $1 and created_at < $2 group by 1) o on o.merchant_id = m.id
     left join (select merchant_id, -sum(amount_cents) as cents from ledger_entries where mode = 'live' and kind = 'fee' and created_at >= $1 and created_at < $2 group by 1) f on f.merchant_id = m.id
     where coalesce(p.amount, 0) + coalesce(o.amount, 0) + coalesce(f.cents, 0) > 0
     order by coalesce(f.cents, 0) desc, coalesce(p.amount, 0) desc limit 1000`,
    [r.start, r.end],
  );
  return rows.map((x) => ({ id: x.id, name: x.name, account_code: x.account_code, collected: Number(x.collected), payments: Number(x.payments), paid_out: Number(x.paid_out), fees: kes(Number(x.fee_cents)) }));
}

/** Fees earned per merchant over a range, for the books. */
export async function revenueCsv(app: App, from?: string, to?: string) {
  const r = range(from, to);
  const rows = await merchantTotals(app, r);
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Merchant", "Account code", "Merchant ID", "Collected (KES)", "Payments", "Paid out (KES)", "Fees earned (KES)"], ...rows.map((x) => [x.name, x.account_code, x.id, x.collected, x.payments, x.paid_out, x.fees])];
  return { body: lines.map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n", filename: `swiftpal-revenue-${r.from}-to-${r.to}.csv` };
}

// ---------- risk ----------

/** Signals worth a look today: payout limits nearly used, very large payouts, and accounts under password attack. */
export async function risk(app: App) {
  const near = (
    await app.db.query(
      `select m.id, m.name, coalesce(m.payout_daily_limit_cents, $1) as limit_cents, t.sent
       from merchants m join (select merchant_id, sum(amount) as sent from payouts where mode = 'live' and status not in ('failed','reversed') and created_at >= ${todayStart} group by 1) t on t.merchant_id = m.id
       where t.sent * 100 >= 0.8 * coalesce(m.payout_daily_limit_cents, $1) order by t.sent desc limit 20`,
      [app.cfg.payoutDailyLimitCents],
    )
  ).rows.map((x) => ({ id: x.id, name: x.name, sent_today: Number(x.sent), limit: kes(Number(x.limit_cents)) }));
  const large = (
    await app.db.query(
      `select o.id, o.merchant_id, m.name, o.amount, o.phone, o.status, o.created_at from payouts o join merchants m on m.id = o.merchant_id
       where o.mode = 'live' and o.amount >= 100000 and o.created_at > now() - interval '24 hours' order by o.amount desc limit 20`,
    )
  ).rows.map((x) => ({ ...x, amount: Number(x.amount) }));
  const attacked = (
    await app.db.query(
      `select e.merchant_id as id, m.name, count(*)::int as failures from account_events e join merchants m on m.id = e.merchant_id
       where e.kind = 'sign_in_failed' and e.created_at > now() - interval '1 hour' group by 1, 2 having count(*) >= 10 order by 3 desc limit 20`,
    )
  ).rows;
  return { near_limit: near, large_payouts: large, failed_sign_ins: attacked };
}
