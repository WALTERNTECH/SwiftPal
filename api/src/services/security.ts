import { randomInt } from "node:crypto";
import type { App } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, hashPassword, open, seal, sha256, verifyPassword } from "../lib.js";
import { blocked, clear, fail, retryIn, tooMany } from "../limits.js";
import { matchedStep, newSecret, otpauthUrl, verifyTotp } from "../totp.js";

// A merchant's own security: two-step sign-in with an authenticator app,
// recovery codes, the sessions signed in to the account, password changes,
// and the activity log that records all of it.

export type Ctx = { ip?: string; ua?: string };
type Person = { id: string; merchant_id: string; email: string };

const WRONG_WINDOW = 15 * 60_000;

// ---------- activity ----------

export async function record(q: Q, merchantId: string, userId: string | null, kind: string, detail: Record<string, unknown> = {}, ctx: Ctx = {}) {
  await q.query(`insert into account_events (merchant_id, user_id, kind, detail, ip, user_agent) values ($1,$2,$3,$4,$5,$6)`, [
    merchantId,
    userId,
    kind,
    JSON.stringify(detail),
    ctx.ip ?? null,
    (ctx.ua ?? "").slice(0, 300) || null,
  ]);
}

export async function activity(app: App, merchantId: string, limit = 100) {
  const { rows } = await app.db.query(
    `select e.id, e.kind, e.detail, e.ip, e.user_agent, e.created_at, u.first_name, u.last_name, u.email
     from account_events e left join users u on u.id = e.user_id
     where e.merchant_id = $1 order by e.created_at desc limit $2`,
    [merchantId, limit],
  );
  return rows;
}

// ---------- passwords ----------

const COMMON = new Set([
  "password", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop", "qwerty1234", "iloveyou12",
  "admin12345", "welcome123", "letmein123", "safaricom1", "safaricom123", "mpesa12345", "swiftpal123", "kenya12345", "nairobi123",
  "0123456789", "abcdefghij", "abc1234567", "passw0rd12", "football12", "monkey1234", "1q2w3e4r5t", "zaq12wsxcde",
]);

/** Length, plus the guessable cases a long password can still be. */
export function checkPassword(pw: string, email?: string) {
  if (pw.length < 10) throw new ApiError(400, "weak_password", "Use at least 10 characters.");
  if (pw.length > 200) throw new ApiError(400, "weak_password", "Use at most 200 characters.");
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw))
    throw new ApiError(400, "weak_password", "That password is too easy to guess. Mix words, numbers and symbols.");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) throw new ApiError(400, "weak_password", "Don't use your email address in your password.");
}

/** Signs out every other session; the one making the change stays signed in. */
export async function changePassword(app: App, user: Person, current: string, next: string, sessionRaw: string, ctx: Ctx) {
  const key = `pwchange:${user.id}`;
  if (blocked(key, 5)) throw tooMany("Too many wrong passwords. Try again in 15 minutes.", retryIn(key));
  const row = await one<{ password_hash: string }>(app.db, `select password_hash from users where id = $1`, [user.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    fail(key, WRONG_WINDOW);
    throw new ApiError(400, "wrong_password", "Your current password isn't right.");
  }
  clear(key);
  checkPassword(next, user.email);
  if (await verifyPassword(next, row.password_hash)) throw new ApiError(400, "same_password", "Choose a password you haven't used here.");
  const hash = await hashPassword(next);
  await app.db.tx(async (q) => {
    await q.query(`update users set password_hash = $2, password_changed_at = now() where id = $1`, [user.id, hash]);
    await q.query(`delete from sessions where user_id = $1 and token_hash <> $2`, [user.id, sha256(sessionRaw)]);
    await record(q, user.merchant_id, user.id, "password_changed", {}, ctx);
  });
  await app.mail
    .send(user.email, "Your SwiftPal password changed", `The password on your SwiftPal account was changed, and other devices were signed out.\n\nIf this wasn't you, reset your password now: ${app.cfg.webUrl}/forgot-password`)
    .catch(() => {});
}

// ---------- sessions ----------

export async function listSessions(app: App, userId: string, sessionRaw: string) {
  const { rows } = await app.db.query(
    `select id, ip, user_agent, created_at, coalesce(last_seen_at, created_at) as last_seen_at, token_hash = $2 as current
     from sessions where user_id = $1 and not otp_pending and expires_at > now() order by coalesce(last_seen_at, created_at) desc`,
    [userId, sha256(sessionRaw)],
  );
  return rows;
}

export async function revokeSession(app: App, user: Person, id: string, ctx: Ctx) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query(`delete from sessions where id = $1 and user_id = $2 returning ip, user_agent`, [id, user.id]);
    if (!rows.length) throw new ApiError(404, "not_found", "No such session.", "not_found");
    await record(q, user.merchant_id, user.id, "session_ended", { ip: rows[0].ip, device: rows[0].user_agent }, ctx);
  });
}

export async function revokeOtherSessions(app: App, user: Person, sessionRaw: string, ctx: Ctx) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query(`delete from sessions where user_id = $1 and token_hash <> $2 returning id`, [user.id, sha256(sessionRaw)]);
    await record(q, user.merchant_id, user.id, "sessions_ended", { count: rows.length }, ctx);
  });
}

// ---------- two-step sign-in ----------

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const recoveryHash = (userId: string, code: string) => sha256(`${userId}:recovery:${code.replace(/[^a-z0-9]/gi, "").toLowerCase()}`);

async function newRecoveryCodes(q: Q, userId: string) {
  const codes = Array.from({ length: 10 }, () => {
    let s = "";
    for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  await q.query(`delete from recovery_codes where user_id = $1`, [userId]);
  for (const c of codes) await q.query(`insert into recovery_codes (user_id, code_hash) values ($1,$2)`, [userId, recoveryHash(userId, c)]);
  return codes;
}

export async function twoFactorStatus(app: App, userId: string) {
  const r = await one<{ enabled_at: string | null; left: number }>(
    app.db,
    `select u.totp_enabled_at as enabled_at, (select count(*)::int from recovery_codes c where c.user_id = u.id and c.used_at is null) as left from users u where u.id = $1`,
    [userId],
  );
  return { enabled: !!r?.enabled_at, enabled_at: r?.enabled_at ?? null, recovery_codes_left: r?.enabled_at ? Number(r.left) : 0 };
}

/** A new secret to scan; it only takes effect once a code from it is confirmed. */
export async function startTwoFactor(app: App, user: Person) {
  const r = await one<{ totp_enabled_at: string | null }>(app.db, `select totp_enabled_at from users where id = $1`, [user.id]);
  if (r?.totp_enabled_at) throw new ApiError(409, "already_enabled", "Two-step verification is already on.");
  const secret = newSecret();
  await app.db.query(`update users set totp_pending_enc = $2 where id = $1`, [user.id, seal(app.cfg.masterKey, secret)]);
  return { secret, otpauth_url: otpauthUrl(secret, user.email, "SwiftPal") };
}

export async function enableTwoFactor(app: App, user: Person, code: string, ctx: Ctx) {
  const key = `2fa:${user.id}`;
  if (blocked(key, 5)) throw tooMany("Too many wrong codes. Try again in 15 minutes.", retryIn(key));
  const r = await one<{ totp_pending_enc: string | null; totp_enabled_at: string | null }>(app.db, `select totp_pending_enc, totp_enabled_at from users where id = $1`, [user.id]);
  if (r?.totp_enabled_at) throw new ApiError(409, "already_enabled", "Two-step verification is already on.");
  if (!r?.totp_pending_enc) throw new ApiError(409, "setup_not_started", "Start the setup again to get a new QR code.");
  const step = verifyTotp(open(app.cfg.masterKey, r.totp_pending_enc), code.trim(), null);
  if (step === null) {
    fail(key, WRONG_WINDOW);
    throw new ApiError(400, "wrong_code", "That code doesn't match. Check the time on your phone is set automatically, then try the current code.");
  }
  clear(key);
  const codes = await app.db.tx(async (q) => {
    await q.query(
      `update users set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_enabled_at = now(), totp_last_step = $2 where id = $1`,
      [user.id, step],
    );
    await record(q, user.merchant_id, user.id, "two_factor_enabled", {}, ctx);
    return newRecoveryCodes(q, user.id);
  });
  await app.mail.send(user.email, "Two-step verification is on", "Your SwiftPal account now asks for a code from your authenticator app at sign-in and before money leaves it. Keep your recovery codes somewhere safe.").catch(() => {});
  return { recovery_codes: codes };
}

/**
 * Checks a code from the authenticator app (or, at sign-in only, an unused
 * recovery code). A code works once; five wrong ones lock for 15 minutes.
 */
export async function verifySecondFactor(app: App, user: Person, raw: string | undefined, ctx: Ctx, opts: { allowRecovery?: boolean } = {}) {
  const code = (raw ?? "").trim();
  if (!code) throw new ApiError(400, "code_required", "Enter the 6-digit code from your authenticator app.");
  const key = `2fa:${user.id}`;
  if (blocked(key, 5)) throw tooMany("Too many wrong codes. Try again in 15 minutes.", retryIn(key));

  if (/^\d{6}$/.test(code)) {
    const out = await app.db.tx(async (q) => {
      const r = await one<{ totp_secret_enc: string | null; totp_last_step: number | null }>(q, `select totp_secret_enc, totp_last_step from users where id = $1 for update`, [user.id]);
      if (!r?.totp_secret_enc) throw new ApiError(409, "two_factor_off", "Two-step verification isn't on for this account.");
      const secret = open(app.cfg.masterKey, r.totp_secret_enc);
      const last = r.totp_last_step === null ? null : Number(r.totp_last_step);
      const step = verifyTotp(secret, code, last);
      if (step !== null) {
        await q.query(`update users set totp_last_step = $2 where id = $1`, [user.id, step]);
        return "ok" as const;
      }
      const seen = matchedStep(secret, code);
      return seen !== null && last !== null && seen <= last ? ("used" as const) : ("wrong" as const);
    });
    if (out === "ok") {
      clear(key);
      return "totp" as const;
    }
    if (out === "used") throw new ApiError(400, "code_used", "That code was just used. Wait for the next one in your app.");
  } else if (opts.allowRecovery && /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(code)) {
    const used = await app.db.tx(async (q) => {
      const { rows } = await q.query(`update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning id`, [
        user.id,
        recoveryHash(user.id, code),
      ]);
      if (rows.length) await record(q, user.merchant_id, user.id, "recovery_code_used", {}, ctx);
      return rows.length > 0;
    });
    if (used) {
      clear(key);
      return "recovery" as const;
    }
  }
  fail(key, WRONG_WINDOW);
  throw new ApiError(400, "wrong_code", opts.allowRecovery ? "That code doesn't match. Use the current code from your app, or a recovery code." : "That code doesn't match. Use the current code from your authenticator app.");
}

export async function disableTwoFactor(app: App, user: Person, password: string, code: string, ctx: Ctx) {
  const row = await one<{ password_hash: string }>(app.db, `select password_hash from users where id = $1`, [user.id]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new ApiError(400, "wrong_password", "Your password isn't right.");
  await verifySecondFactor(app, user, code, ctx);
  await app.db.tx(async (q) => {
    await q.query(`update users set totp_secret_enc = null, totp_pending_enc = null, totp_enabled_at = null, totp_last_step = null where id = $1`, [user.id]);
    await q.query(`delete from recovery_codes where user_id = $1`, [user.id]);
    await record(q, user.merchant_id, user.id, "two_factor_disabled", {}, ctx);
  });
  await app.mail.send(user.email, "Two-step verification was turned off", `Two-step verification was turned off on your SwiftPal account. If this wasn't you, reset your password now: ${app.cfg.webUrl}/forgot-password`).catch(() => {});
}

export async function regenerateRecoveryCodes(app: App, user: Person, code: string, ctx: Ctx) {
  await verifySecondFactor(app, user, code, ctx);
  return app.db.tx(async (q) => {
    await record(q, user.merchant_id, user.id, "recovery_codes_renewed", {}, ctx);
    return { recovery_codes: await newRecoveryCodes(q, user.id) };
  });
}

export async function hasTwoFactor(q: Q, userId: string) {
  return !!(await one(q, `select 1 from users where id = $1 and totp_enabled_at is not null`, [userId]));
}

/** Console support action: the person set up their authenticator again. */
export async function resetTwoFactor(q: Q, userId: string) {
  await q.query(`update users set totp_secret_enc = null, totp_pending_enc = null, totp_enabled_at = null, totp_last_step = null where id = $1`, [userId]);
  await q.query(`delete from recovery_codes where user_id = $1`, [userId]);
}
