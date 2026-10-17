import { randomInt } from "node:crypto";
import type { App, Mode } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, hashPassword, newId, normalisePhone, open, seal, sha256, token, verifyPassword } from "../lib.js";
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
  created_at: string;
};

export type User = {
  id: string;
  merchant_id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  role: string;
  email_verified_at: string | null;
  created_at: string;
};

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
const USER_COLS = "id, merchant_id, email, phone, first_name, last_name, role, email_verified_at, created_at";

// ---------- sign-up and email codes ----------

export async function signUp(app: App, input: { firstName: string; lastName: string; email: string; phone: string; password: string; ip?: string; ua?: string }) {
  const email = input.email.trim().toLowerCase();
  const phone = normalisePhone(input.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Enter a Safaricom number, e.g. 0712 345 678.");
  if (input.password.length < 10) throw new ApiError(400, "weak_password", "Use at least 10 characters.");
  const passwordHash = await hashPassword(input.password);
  const { user, code, session } = await app.db.tx(async (q) => {
    if (await one(q, `select 1 from users where email = $1`, [email])) throw new ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    const merchantId = newId("mer");
    const accountCode = await uniqueAccountCode(q);
    await q.query(`insert into merchants (id, account_code, name) values ($1,$2,$3)`, [merchantId, accountCode, `${input.firstName.trim()} ${input.lastName.trim()}`]);
    await createBalances(q, merchantId);
    const userId = newId("usr");
    await q.query(
      `insert into users (id, merchant_id, email, phone, first_name, last_name, password_hash) values ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, merchantId, email, phone, input.firstName.trim(), input.lastName.trim(), passwordHash],
    );
    const code = await newEmailCode(q, userId);
    const session = await createSession(q, userId, input.ip, input.ua);
    const user = (await one<User>(q, `select ${USER_COLS} from users where id = $1`, [userId]))!;
    return { user, code, session };
  });
  await sendCode(app, user.email, code);
  return { user, session };
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
  const recent = await one<{ n: number }>(app.db, `select count(*)::int as n from email_codes where user_id = $1 and created_at > now() - interval '30 seconds'`, [userId]);
  if (recent && recent.n > 0) throw new ApiError(429, "too_soon", "Wait 30 seconds before asking for another code.", "rate_limit_error");
  const code = await app.db.tx((q) => newEmailCode(q, userId));
  await sendCode(app, user.email, code);
}

export async function verifyEmail(app: App, userId: string, code: string) {
  return app.db.tx(async (q) => {
    const row = await one<{ id: number; code_hash: string; attempts: number; expired: boolean }>(
      q,
      `select id, code_hash, attempts, expires_at < now() as expired from email_codes
       where user_id = $1 and used_at is null order by id desc limit 1 for update`,
      [userId],
    );
    if (!row || row.expired) throw new ApiError(400, "code_expired", "That code has expired. Ask for a new one.");
    if (row.attempts >= 5) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Ask for a new one.", "rate_limit_error");
    if (row.code_hash !== sha256(`${userId}:${code.trim()}`)) {
      await q.query(`update email_codes set attempts = attempts + 1 where id = $1`, [row.id]);
      throw new ApiError(400, "wrong_code", "That code doesn't match. Check the latest email.");
    }
    await q.query(`update email_codes set used_at = now() where id = $1`, [row.id]);
    await q.query(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    const user = (await one<User>(q, `select ${USER_COLS} from users where id = $1`, [userId]))!;
    const hasTestKey = await one(q, `select 1 from api_keys where merchant_id = $1 and mode = 'test' and revoked_at is null`, [user.merchant_id]);
    if (!hasTestKey) await insertKey(app, q, user.merchant_id, "test", "Default test key", [...SCOPES]);
    return user;
  });
}

// ---------- sign-in and sessions ----------

const attempts = new Map<string, { n: number; until: number }>();

export async function signIn(app: App, input: { email: string; password: string; ip?: string; ua?: string }) {
  const email = input.email.trim().toLowerCase();
  const k = `${email}|${input.ip ?? ""}`;
  const a = attempts.get(k);
  if (a && a.until > Date.now() && a.n >= 10) throw new ApiError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.", "rate_limit_error");
  const row = await one<User & { password_hash: string }>(app.db, `select ${USER_COLS}, password_hash from users where email = $1`, [email]);
  const ok = row ? await verifyPassword(input.password, row.password_hash) : await verifyPassword(input.password, "scrypt$AAAA$AAAA");
  if (!row || !ok) {
    attempts.set(k, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.", "authentication_error");
  }
  attempts.delete(k);
  const session = await createSession(app.db, row.id, input.ip, input.ua);
  const { password_hash: _drop, ...user } = row;
  return { user: user as User, session };
}

async function createSession(q: Q, userId: string, ip?: string, ua?: string) {
  const t = token(32);
  await q.query(`insert into sessions (token_hash, user_id, ip, user_agent, expires_at) values ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`, [
    sha256(t),
    userId,
    ip ?? null,
    (ua ?? "").slice(0, 300),
    String(SESSION_DAYS),
  ]);
  return t;
}

export async function sessionUser(app: App, raw: string | undefined) {
  if (!raw) return null;
  const row = await one<User & { expired: boolean }>(
    app.db,
    `select u.id, u.merchant_id, u.email, u.phone, u.first_name, u.last_name, u.role, u.email_verified_at, u.created_at, s.expires_at < now() as expired
     from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [sha256(raw)],
  );
  if (!row || row.expired) return null;
  const { expired: _e, ...user } = row;
  return user as User;
}

export async function signOut(app: App, raw: string | undefined) {
  if (raw) await app.db.query(`delete from sessions where token_hash = $1`, [sha256(raw)]);
}

export async function getMerchant(q: Q, id: string) {
  return (await one<Merchant>(q, `select * from merchants where id = $1`, [id]))!;
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
  if (mode === "live" && !merchant.live_enabled) throw new ApiError(403, "account_not_live", "Live keys are issued once a Till or Paybill is verified.", "permission_error");
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
