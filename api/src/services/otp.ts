import { randomInt } from "node:crypto";
import type { App } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, sha256 } from "../lib.js";

// One-time SMS codes to the account's phone: proving the number at sign-up,
// the second step of every sign-in, and confirming live money movements from
// the dashboard. A code is bound to its purpose and, for money, to the exact
// amount and recipient it was sent for.

export type Purpose = "verify_phone" | "login" | "withdraw" | "payout" | "batch" | "phone_change_current" | "phone_change_new";

const TTL_MINUTES: Record<Purpose, number> = {
  verify_phone: 10,
  login: 5,
  withdraw: 5,
  payout: 5,
  batch: 5,
  phone_change_current: 10,
  phone_change_new: 10,
};

export const maskPhone = (p: string) => `${p.slice(0, 6)}•••${p.slice(-3)}`;

/** Sends a fresh code and voids earlier unused ones for the same purpose. */
export async function issue(app: App, a: { userId: string; purpose: Purpose; phone: string; payload?: string; text: (code: string) => string }) {
  const recent = await one<{ last30s: number; lastHour: number }>(
    app.db,
    `select count(*) filter (where purpose = $2 and created_at > now() - interval '30 seconds')::int as "last30s", count(*)::int as "lastHour"
     from otp_codes where user_id = $1 and created_at > now() - interval '1 hour'`,
    [a.userId, a.purpose],
  );
  if (recent && recent.last30s > 0) throw new ApiError(429, "too_soon", "Wait 30 seconds before asking for another code.", "rate_limit_error");
  if (recent && recent.lastHour >= 12) throw new ApiError(429, "too_many_codes", "Too many codes requested. Try again in an hour.", "rate_limit_error");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = await app.db.tx(async (q) => {
    await q.query(`update otp_codes set used_at = now() where user_id = $1 and purpose = $2 and used_at is null`, [a.userId, a.purpose]);
    const r = await one<{ id: number }>(
      q,
      `insert into otp_codes (user_id, purpose, target, payload_hash, code_hash, expires_at)
       values ($1,$2,$3,$4,$5, now() + ($6 || ' minutes')::interval) returning id`,
      [a.userId, a.purpose, a.phone, a.payload ? sha256(a.payload) : null, hashCode(a.userId, a.purpose, code), String(TTL_MINUTES[a.purpose])],
    );
    return r!.id;
  });
  try {
    await app.sms.send(a.phone, a.text(code));
  } catch (e) {
    await app.db.query(`update otp_codes set used_at = now() where id = $1`, [id]);
    throw e;
  }
  return { phone_hint: maskPhone(a.phone), expires_in: TTL_MINUTES[a.purpose] * 60 };
}

type Check = { userId: string; purpose: Purpose; code: string | undefined; payload?: string };

/**
 * Uses up the latest code for each purpose, all or none. A wrong guess is
 * counted in its own committed transaction, so throwing can't roll it back.
 */
export async function check(app: App, ...checks: Check[]) {
  for (const a of checks) if (!a.code || !/^\d{6}$/.test(a.code.trim())) throw new ApiError(400, "code_required", "Enter the 6-digit code we sent by SMS.");
  const wrong = await app.db.tx(async (q) => {
    const rows = [];
    for (const a of checks) {
      const row = await latest(q, a);
      if (!row || row.expired) throw new ApiError(400, "code_expired", "That code has expired. Ask for a new one.");
      if (row.attempts >= 5) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Ask for a new one.", "rate_limit_error");
      rows.push({ a, row, ok: row.code_hash === hashCode(a.userId, a.purpose, a.code!.trim()) });
    }
    const bad = rows.filter((r) => !r.ok);
    for (const r of bad) await q.query(`update otp_codes set attempts = attempts + 1 where id = $1`, [r.row.id]);
    if (bad.length) return true;
    for (const { a, row } of rows) {
      if ((row.payload_hash ?? null) !== (a.payload ? sha256(a.payload) : null)) {
        throw new ApiError(400, "code_mismatch", "That code was sent for a different request. Ask for a new one.");
      }
    }
    for (const { row } of rows) await q.query(`update otp_codes set used_at = now() where id = $1`, [row.id]);
    return false;
  });
  if (wrong) throw new ApiError(400, "wrong_code", "That code doesn't match. Check the latest SMS.");
}

const latest = (q: Q, a: Check) =>
  one<{ id: number; code_hash: string; payload_hash: string | null; attempts: number; expired: boolean }>(
    q,
    `select id, code_hash, payload_hash, attempts, expires_at < now() as expired from otp_codes
     where user_id = $1 and purpose = $2 and used_at is null order by id desc limit 1 for update`,
    [a.userId, a.purpose],
  );

const hashCode = (userId: string, purpose: string, code: string) => sha256(`${userId}:${purpose}:${code}`);
