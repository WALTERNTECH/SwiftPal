import { randomInt } from "node:crypto";
import type { App, Mode } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, hashPassword, newId, normalisePhone, open, seal, sha256, token, verifyPassword } from "../lib.js";
import { blocked, clear, fail, retryIn, tooMany } from "../limits.js";
import * as otp from "./otp.js";
import { checkPassword, record, verifySecondFactor, type Ctx } from "./security.js";
import { createBalances } from "./wallet.js";

export type Merchant = {
  id: string;
  account_code: string;
  name: string;
  type: "individual" | "company" | "ngo";
  industry: string | null;
  monthly_volume: string | null;
  website: string | null;
  verification_status: "not_started" | "submitted" | "approved" | "rejected";
  auto_cover: boolean;
  low_balance_at_cents: number;
  starter_credit_given: boolean;
  onboarding_done: boolean;
  live_enabled: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  payout_daily_limit_cents: number | null;
  stk_fee_cents: number | null;
  b2c_fee_pct: number | null;
  created_at: string;
};

/** A suspended account keeps its data but can't move money or make keys. */
export function assertActive(m: Pick<Merchant, "suspended_at">) {
  if (m.suspended_at) throw new ApiError(403, "account_suspended", "This account is suspended. Contact SwiftPal support.", "permission_error");
}

export type User = {
  id: string;
  merchant_id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  role: Role;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  totp_enabled_at: string | null;
  created_at: string;
};

export type Role = "owner" | "admin" | "developer" | "finance" | "support";

export type ApiKeyRow = {
  id: string;
  merchant_id: string;
  mode: Mode;
  name: string;
  prefix: string;
  last4: string;
  secret_enc: string | null;
  scopes: string[];
  ip_allowlist: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export const SCOPES = ["payments:write", "payouts:write", "read"] as const;
const SESSION_DAYS = 30;
const USER_COLS = "id, merchant_id, email, phone, first_name, last_name, role, email_verified_at, phone_verified_at, totp_enabled_at, created_at";
const U_COLS = USER_COLS.split(", ").map((c) => `u.${c}`).join(", ");

// ---------- sign-up: phone code, then email code ----------

export async function signUp(app: App, input: { firstName: string; lastName: string; email: string; phone: string; password: string; ip?: string; ua?: string }) {
  const email = input.email.trim().toLowerCase();
  const phone = normalisePhone(input.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Enter a Safaricom number, e.g. 0712 345 678.");
  checkPassword(input.password, email);
  const passwordHash = await hashPassword(input.password);
  const { user, session } = await app.db.tx(async (q) => {
    if (await one(q, `select 1 from users where email = $1`, [email])) throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    const merchantId = newId("mer");
    const accountCode = await uniqueAccountCode(q);
    await q.query(`insert into merchants (id, account_code, name) values ($1,$2,$3)`, [merchantId, accountCode, `${input.firstName.trim()} ${input.lastName.trim()}`]);
    await createBalances(q, merchantId);
    const userId = newId("usr");
    // With codes off, the number and email are taken as given.
    const verified = app.cfg.codes ? null : new Date().toISOString();
    await q.query(
      `insert into users (id, merchant_id, email, phone, first_name, last_name, password_hash, phone_verified_at, email_verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [userId, merchantId, email, phone, input.firstName.trim(), input.lastName.trim(), passwordHash, verified],
    );
    const session = await createSession(q, userId, input.ip, input.ua);
    await record(q, merchantId, userId, "signed_up", {}, input);
    const user = (await one<User>(q, `select ${USER_COLS} from users where id = $1`, [userId]))!;
    return { user, session };
  });
  // A failed SMS doesn't undo the account; the verify screen can resend.
  if (app.cfg.codes) await sendPhoneCode(app, user).catch((e: Error) => app.log.warn("sign-up sms", e.message));
  return { user, session };
}

const sendPhoneCode = (app: App, user: User) =>
  otp.issue(app, {
    userId: user.id,
    purpose: "verify_phone",
    phone: user.phone,
    text: (c) => `${c} is your SwiftPal verification code. It expires in 10 minutes.`,
  });

export async function resendPhoneCode(app: App, userId: string) {
  const user = await one<User>(app.db, `select ${USER_COLS} from users where id = $1`, [userId]);
  if (!user) throw new ApiError(404, "not_found", "No such user.", "not_found");
  if (user.phone_verified_at) return { phone_hint: otp.maskPhone(user.phone), expires_in: 0 };
  return sendPhoneCode(app, user);
}

/** Proves the number, then sends the email code. */
export async function verifyPhone(app: App, userId: string, code: string) {
  await otp.check(app, { userId, purpose: "verify_phone", code });
  await app.db.query(`update users set phone_verified_at = now() where id = $1 and phone_verified_at is null`, [userId]);
  const user = (await one<User>(app.db, `select ${USER_COLS} from users where id = $1`, [userId]))!;
  if (!user.email_verified_at) {
    const emailCode = await app.db.tx((q) => newEmailCode(q, userId));
    await sendCode(app, user.email, emailCode);
  }
  return user;
}

async function uniqueAccountCode(q: Q) {
  for (;;) {
    const code = `SP${randomInt(100000, 999999)}`;
    if (!(await one(q, `select 1 from merchants where account_code = $1`, [code]))) return code;
  }
}

async function newEmailCode(q: Q, userId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await q.query(`update email_codes set used_at = now() where user_id = $1 and used_at is null`, [userId]);
  await q.query(`insert into email_codes (user_id, code_hash, expires_at) values ($1,$2, now() + interval '10 minutes')`, [userId, sha256(`${userId}:${code}`)]);
  return code;
}

async function sendCode(app: App, email: string, code: string) {
  await app.mail.send(email, `${code} is your SwiftPal code`, `Your SwiftPal verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't sign up, ignore this email.`);
}

export async function resendCode(app: App, userId: string) {
  const user = await one<User>(app.db, `select ${USER_COLS} from users where id = $1`, [userId]);
  if (!user) throw new ApiError(404, "not_found", "No such user.", "not_found");
  if (user.email_verified_at) return;
  if (!user.phone_verified_at) throw new ApiError(403, "phone_unverified", "Verify your phone number first.", "permission_error");
  const recent = await one<{ n: number }>(app.db, `select count(*)::int as n from email_codes where user_id = $1 and created_at > now() - interval '30 seconds'`, [userId]);
  if (recent && recent.n > 0) throw new ApiError(429, "too_soon", "Wait 30 seconds before asking for another code.", "rate_limit_error");
  const code = await app.db.tx((q) => newEmailCode(q, userId));
  await sendCode(app, user.email, code);
}

export async function verifyEmail(app: App, userId: string, code: string) {
  const user = await app.db.tx(async (q) => {
    const row = await one<{ id: number; code_hash: string; attempts: number; expired: boolean }>(
      q,
      `select id, code_hash, attempts, expires_at < now() as expired from email_codes
       where user_id = $1 and used_at is null order by id desc limit 1 for update`,
      [userId],
    );
    if (!row || row.expired) throw new ApiError(400, "code_expired", "That code has expired. Ask for a new one.");
    if (row.attempts >= 5) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Ask for a new one.", "rate_limit_error");
    if (row.code_hash !== sha256(`${userId}:${code.trim()}`)) {
      // Returned rather than thrown, so the counted attempt commits.
      await q.query(`update email_codes set attempts = attempts + 1 where id = $1`, [row.id]);
      return null;
    }
    await q.query(`update email_codes set used_at = now() where id = $1`, [row.id]);
    await q.query(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    const user = (await one<User>(q, `select ${USER_COLS} from users where id = $1`, [userId]))!;
    return user;
  });
  if (!user) throw new ApiError(400, "wrong_code", "That code doesn't match. Check the latest email.");
  return user;
}

// ---------- sign-in and sessions ----------

/**
 * Wrong passwords are counted per email from any address (so rotating IPs
 * doesn't help guess one account) and per address (so one source can't try
 * many accounts). Either lock lasts 15 minutes from the last wrong guess.
 */
export async function signIn(app: App, input: { email: string; password: string; ip?: string; ua?: string }) {
  const email = input.email.trim().toLowerCase();
  const byEmail = `login:email:${email}`;
  const byIp = `login:ip:${input.ip ?? ""}`;
  if (blocked(byEmail, 10) || blocked(byIp, 30)) throw tooMany("Too many attempts. Try again in 15 minutes.", Math.max(retryIn(byEmail), retryIn(byIp)));
  const row = await one<User & { password_hash: string; disabled_at: string | null }>(app.db, `select ${USER_COLS}, password_hash, disabled_at from users where email = $1`, [email]);
  const ok = row ? await verifyPassword(input.password, row.password_hash) : await verifyPassword(input.password, "scrypt$AAAA$AAAA");
  if (!row || !ok || row.disabled_at) {
    fail(byEmail, 15 * 60_000);
    fail(byIp, 15 * 60_000);
    if (row && !ok) await record(app.db, row.merchant_id, row.id, "sign_in_failed", {}, input);
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.", "authentication_error");
  }
  clear(byEmail);
  const { password_hash: _drop, disabled_at: _d, ...rest } = row;
  const user = rest as User;
  // An authenticator app wins over SMS: it works without signal and can't be SIM-swapped.
  if (user.totp_enabled_at) return { user, session: await createSession(app.db, user.id, input.ip, input.ua, true), otp: { method: "totp" as const } };
  // An account that never proved its number finishes sign-up first; there's no phone to send to.
  if (!app.cfg.codes || !user.phone_verified_at) {
    await record(app.db, user.merchant_id, user.id, "signed_in", { method: "password" }, input);
    return { user, session: await createSession(app.db, user.id, input.ip, input.ua), otp: null };
  }
  const session = await createSession(app.db, user.id, input.ip, input.ua, true);
  const sent = await sendLoginCode(app, user).catch((e: ApiError) => ({ phone_hint: otp.maskPhone(user.phone), expires_in: 0, error: e.message }));
  return { user, session, otp: { method: "sms" as const, ...sent } };
}

const sendLoginCode = (app: App, user: User) =>
  otp.issue(app, {
    userId: user.id,
    purpose: "login",
    phone: user.phone,
    text: (c) => `${c} is your SwiftPal sign-in code. It expires in 5 minutes. If you didn't try to sign in, change your password.`,
  });

async function pendingUser(app: App, raw: string | undefined) {
  if (!raw) return null;
  return one<User>(
    app.db,
    `select ${U_COLS} from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.otp_pending and s.created_at > now() - interval '15 minutes' and u.disabled_at is null`,
    [sha256(raw)],
  );
}

export async function resendLoginCode(app: App, raw: string | undefined) {
  const user = await pendingUser(app, raw);
  if (!user) throw new ApiError(401, "login_expired", "Sign in again to get a new code.", "authentication_error");
  if (user.totp_enabled_at) throw new ApiError(400, "authenticator", "Use the code from your authenticator app.");
  return sendLoginCode(app, user);
}

/** Second step of sign-in: swaps the pending session for a full one. */
export async function completeLogin(app: App, raw: string | undefined, code: string, ip?: string, ua?: string) {
  const user = await pendingUser(app, raw);
  if (!user) throw new ApiError(401, "login_expired", "Sign in again to get a new code.", "authentication_error");
  const ctx: Ctx = { ip, ua };
  let method: string = "sms";
  if (user.totp_enabled_at) method = await verifySecondFactor(app, user, code, ctx, { allowRecovery: true });
  else await otp.check(app, { userId: user.id, purpose: "login", code });
  return app.db.tx(async (q) => {
    await q.query(`delete from sessions where token_hash = $1`, [sha256(raw!)]);
    await record(q, user.merchant_id, user.id, "signed_in", { method }, ctx);
    return { user, session: await createSession(q, user.id, ip, ua) };
  });
}

async function createSession(q: Q, userId: string, ip?: string, ua?: string, otpPending = false) {
  const t = token(32);
  await q.query(
    `insert into sessions (token_hash, user_id, ip, user_agent, otp_pending, expires_at) values ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)`,
    [sha256(t), userId, ip ?? null, (ua ?? "").slice(0, 300), otpPending, String(SESSION_DAYS)],
  );
  return t;
}

/** A full session for someone who just proved who they are another way (an accepted invite). */
export const openSession = (app: App, userId: string, ip?: string, ua?: string) => createSession(app.db, userId, ip, ua);

export async function sessionUser(app: App, raw: string | undefined) {
  if (!raw) return null;
  const hash = sha256(raw);
  const row = await one<User & { expired: boolean; stale: boolean }>(
    app.db,
    `select ${U_COLS}, s.expires_at < now() as expired, coalesce(s.last_seen_at, s.created_at) < now() - interval '5 minutes' as stale
     from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and not s.otp_pending and u.disabled_at is null`,
    [hash],
  );
  if (!row || row.expired) return null;
  // Last seen, at most every five minutes, for the sessions list.
  if (row.stale) app.db.query(`update sessions set last_seen_at = now() where token_hash = $1`, [hash]).catch(() => {});
  const { expired: _e, stale: _s, ...user } = row;
  return user as User;
}

export async function signOut(app: App, raw: string | undefined) {
  if (raw) await app.db.query(`delete from sessions where token_hash = $1`, [sha256(raw)]);
}

// ---------- password reset ----------

/** Always succeeds from the caller's side, so it can't be used to find accounts. */
export async function requestReset(app: App, email: string) {
  const user = await one<User>(app.db, `select ${USER_COLS} from users where email = $1`, [email.trim().toLowerCase()]);
  if (!user) return;
  const recent = await one<{ n: number }>(app.db, `select count(*)::int as n from password_resets where user_id = $1 and created_at > now() - interval '1 minute'`, [user.id]);
  if (recent && recent.n > 0) return;
  const t = token(32);
  await app.db.query(`insert into password_resets (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 minutes')`, [sha256(t), user.id]);
  await app.mail.send(
    user.email,
    "Reset your SwiftPal password",
    `Use this link to set a new password. It works once, for 30 minutes:\n\n${app.cfg.webUrl}/reset-password?token=${t}\n\nIf you didn't ask for this, ignore this email.`,
  );
}

/** Sets the new password and signs every session out. Signing in again needs the SMS code. */
export async function resetPassword(app: App, raw: string, password: string, ctx: Ctx = {}) {
  const owner = await one<{ email: string }>(app.db, `select u.email from password_resets r join users u on u.id = r.user_id where r.token_hash = $1`, [sha256(raw)]);
  checkPassword(password, owner?.email);
  const hash = await hashPassword(password);
  return app.db.tx(async (q) => {
    const r = await one<{ user_id: string; merchant_id: string; bad: boolean }>(
      q,
      `select r.user_id, u.merchant_id, (r.used_at is not null or r.expires_at < now()) as bad
       from password_resets r join users u on u.id = r.user_id where r.token_hash = $1 for update of r`,
      [sha256(raw)],
    );
    if (!r || r.bad) throw new ApiError(400, "invalid_reset_link", "This reset link has expired or was already used. Ask for a new one.");
    await q.query(`update password_resets set used_at = now() where token_hash = $1`, [sha256(raw)]);
    await q.query(`update users set password_hash = $2, password_changed_at = now(), email_verified_at = coalesce(email_verified_at, now()) where id = $1`, [r.user_id, hash]);
    // Everyone signed in with the old password is signed out. Two-step verification stays on.
    await q.query(`delete from sessions where user_id = $1`, [r.user_id]);
    await record(q, r.merchant_id, r.user_id, "password_reset", {}, ctx);
  });
}

// ---------- phone change: a code to the current number and one to the new ----------

export async function startPhoneChange(app: App, user: User, phone: string) {
  if (!app.cfg.codes) throw new ApiError(403, "phone_change_unavailable", "Contact support to change your number.", "permission_error");
  if (phone === user.phone) throw new ApiError(400, "same_phone", "That's already your number.");
  await otp.issue(app, {
    userId: user.id,
    purpose: "phone_change_current",
    phone: user.phone,
    payload: phone,
    text: (c) => `${c} is your SwiftPal code to move your account to ${otp.maskPhone(phone)}. If this wasn't you, change your password now.`,
  });
  await otp.issue(app, {
    userId: user.id,
    purpose: "phone_change_new",
    phone,
    payload: phone,
    text: (c) => `${c} is your SwiftPal code to confirm this number. It expires in 10 minutes.`,
  });
  return { current_hint: otp.maskPhone(user.phone), new_hint: otp.maskPhone(phone) };
}

export async function confirmPhoneChange(app: App, user: User, phone: string, currentCode: string, newCode: string) {
  await otp.check(
    app,
    { userId: user.id, purpose: "phone_change_current", code: currentCode, payload: phone },
    { userId: user.id, purpose: "phone_change_new", code: newCode, payload: phone },
  );
  await app.db.query(`update users set phone = $2, phone_verified_at = now() where id = $1`, [user.id, phone]);
  await record(app.db, user.merchant_id, user.id, "phone_changed", { phone: otp.maskPhone(phone) });
  await app.mail.send(
    user.email,
    "Your SwiftPal phone number changed",
    `The M-Pesa number on your SwiftPal account is now ${otp.maskPhone(phone)}. Sign-in codes and withdrawals go there from now on.

If you didn't do this, reset your password and contact support.`,
  );
}

export async function getMerchant(q: Q, id: string) {
  return (await one<Merchant>(q, `select * from merchants where id = $1`, [id]))!;
}

/** The account owner: withdrawals only ever go to their verified number. */
export async function ownerOf(q: Q, merchantId: string) {
  return (await one<User>(q, `select ${USER_COLS} from users where merchant_id = $1 and role = 'owner' order by created_at limit 1`, [merchantId]))!;
}

// ---------- API keys ----------

const ALNUM = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function rawKey(mode: Mode) {
  let s = "";
  for (let i = 0; i < 32; i++) s += ALNUM[randomInt(0, ALNUM.length)];
  return `sp_${mode}_${s}`;
}

export async function insertKey(app: App, q: Q, merchantId: string, mode: Mode, name: string, scopes: string[]) {
  const secret = rawKey(mode);
  const id = newId("key");
  await q.query(
    `insert into api_keys (id, merchant_id, mode, name, prefix, last4, key_hash, secret_enc, scopes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, merchantId, mode, name, secret.slice(0, 12), secret.slice(-4), sha256(secret), mode === "test" ? seal(app.cfg.masterKey, secret) : null, scopes],
  );
  return { id, secret };
}

export async function createKey(app: App, merchant: Merchant, mode: Mode, name: string, scopes: string[]) {
  if (!name.trim()) throw new ApiError(400, "invalid_name", "Give the key a name.");
  const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (!scopes.length || bad.length) throw new ApiError(400, "invalid_scopes", `Scopes must be from ${SCOPES.join(", ")}.`);
  assertActive(merchant);
  if (mode === "live" && !merchant.live_enabled) throw new ApiError(403, "account_not_live", "API keys open once your account is verified.", "permission_error");
  if (mode === "live" && scopes.includes("payouts:write") && merchant.verification_status !== "approved")
    throw new ApiError(403, "payouts_not_enabled", "Live payouts need a verified account.", "permission_error");
  return app.db.tx((q) => insertKey(app, q, merchant.id, mode, name.trim(), scopes));
}

export async function rollKey(app: App, merchantId: string, keyId: string) {
  return app.db.tx(async (q) => {
    const k = await one<ApiKeyRow>(q, `select * from api_keys where id = $1 and merchant_id = $2 and revoked_at is null for update`, [keyId, merchantId]);
    if (!k) throw new ApiError(404, "not_found", "No such key.", "not_found");
    await q.query(`update api_keys set revoked_at = now() where id = $1`, [k.id]);
    return insertKey(app, q, merchantId, k.mode, k.name, k.scopes);
  });
}

export async function revokeKey(app: App, merchantId: string, keyId: string) {
  const { rows } = await app.db.query(`update api_keys set revoked_at = now() where id = $1 and merchant_id = $2 and revoked_at is null returning id`, [keyId, merchantId]);
  if (!rows.length) throw new ApiError(404, "not_found", "No such key.", "not_found");
}

export async function listKeys(app: App, merchantId: string) {
  const { rows } = await app.db.query<ApiKeyRow>(`select * from api_keys where merchant_id = $1 and revoked_at is null order by created_at`, [merchantId]);
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    mode: k.mode,
    // Test secrets can be shown again; live ones only at creation.
    secret: k.secret_enc ? open(app.cfg.masterKey, k.secret_enc) : null,
    masked: `${k.prefix}${"•".repeat(16)}${k.last4}`,
    scopes: k.scopes,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
  }));
}

const lastTouch = new Map<string, number>();
export async function authenticateKey(app: App, raw: string) {
  if (!/^sp_(test|live)_[A-Za-z0-9]{20,}$/.test(raw)) return null;
  const k = await one<ApiKeyRow>(app.db, `select * from api_keys where key_hash = $1 and revoked_at is null`, [sha256(raw)]);
  if (!k) return null;
  const now = Date.now();
  if ((lastTouch.get(k.id) ?? 0) < now - 60_000) {
    lastTouch.set(k.id, now);
    app.db.query(`update api_keys set last_used_at = now() where id = $1`, [k.id]).catch(() => {});
  }
  const merchant = await getMerchant(app.db, k.merchant_id);
  return { key: k, merchant };
}
