import type { App } from "../app.js";
import { one, type Q } from "../db.js";
import { ApiError, hashPassword, newId, open, safeEqual, seal, sha256, token, verifyPassword } from "../lib.js";
import { newSecret, otpauthUrl, verifyTotp } from "../totp.js";

// Staff accounts for the admin console. A password opens a short-lived session
// that can only finish sign-in: enrol an authenticator app the first time,
// enter its code every time after. Only then is the session full.

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin";
  totp_enabled_at: string | null;
  disabled_at: string | null;
  last_login_at: string | null;
  created_at: string;
};
export type Stage = "enroll" | "totp" | "full";

const COLS = "a.id, a.email, a.name, a.role, a.totp_enabled_at, a.disabled_at, a.last_login_at, a.created_at";
const FULL_HOURS = 12;
const STEP_MINUTES = 15;

export async function audit(q: Q, actor: string | null, action: string, target: { type?: string; id?: string } = {}, detail: Record<string, unknown> = {}, ip?: string) {
  await q.query(`insert into admin_audit (admin_id, action, target_type, target_id, detail, ip) values ($1,$2,$3,$4,$5,$6)`, [
    actor,
    action,
    target.type ?? null,
    target.id ?? null,
    JSON.stringify(detail),
    ip ?? null,
  ]);
}

async function createSession(q: Q, adminId: string, stage: Stage, ip?: string, ua?: string) {
  const t = token(32);
  const ttl = stage === "full" ? `${FULL_HOURS} hours` : `${STEP_MINUTES} minutes`;
  await q.query(`insert into admin_sessions (token_hash, admin_id, stage, ip, user_agent, expires_at) values ($1,$2,$3,$4,$5, now() + $6::interval)`, [
    sha256(t),
    adminId,
    stage,
    ip ?? null,
    (ua ?? "").slice(0, 300),
    ttl,
  ]);
  return { token: t, maxAge: stage === "full" ? FULL_HOURS * 3600 : STEP_MINUTES * 60 };
}

export async function needsSetup(app: App) {
  const r = await one<{ n: number }>(app.db, `select count(*)::int as n from admins`);
  return (r?.n ?? 0) === 0;
}

/** The first account, made with the server's setup key. Once one exists, setup is closed for good. */
export async function setup(app: App, input: { setupKey: string; name: string; email: string; password: string }, ip?: string, ua?: string) {
  if (!app.cfg.adminToken || !safeEqual(input.setupKey.trim(), app.cfg.adminToken)) throw new ApiError(403, "invalid_setup_key", "That setup key isn't right.", "permission_error");
  if (input.password.length < 12) throw new ApiError(400, "weak_password", "Use at least 12 characters.");
  const hash = await hashPassword(input.password);
  return app.db.tx(async (q) => {
    await q.query(`lock table admins in exclusive mode`);
    if (await one(q, `select 1 from admins limit 1`)) throw new ApiError(409, "already_set_up", "The owner account already exists. Sign in instead.");
    const id = newId("adm");
    await q.query(`insert into admins (id, email, name, password_hash, role) values ($1,$2,$3,$4,'owner')`, [id, input.email.trim().toLowerCase(), input.name.trim(), hash]);
    await audit(q, id, "admin.setup", { type: "admin", id }, {}, ip);
    return { session: await createSession(q, id, "enroll", ip, ua), stage: "enroll" as Stage };
  });
}

const failures = new Map<string, { n: number; until: number }>();
const tooMany = (k: string) => {
  const f = failures.get(k);
  return !!f && f.until > Date.now() && f.n >= 5;
};
const fail = (k: string) => {
  const f = failures.get(k);
  failures.set(k, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
};

export async function login(app: App, email: string, password: string, ip?: string, ua?: string) {
  const e = email.trim().toLowerCase();
  if (tooMany(`pw:${e}`) || tooMany(`ip:${ip}`)) throw new ApiError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.", "rate_limit_error");
  const row = await one<Admin & { password_hash: string }>(app.db, `select ${COLS}, a.password_hash from admins a where a.email = $1`, [e]);
  const ok = row ? await verifyPassword(password, row.password_hash) : await verifyPassword(password, "scrypt$AAAA$AAAA");
  if (!row || !ok || row.disabled_at) {
    fail(`pw:${e}`);
    fail(`ip:${ip}`);
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.", "authentication_error");
  }
  failures.delete(`pw:${e}`);
  const stage: Stage = row.totp_enabled_at ? "totp" : "enroll";
  return { session: await createSession(app.db, row.id, stage, ip, ua), stage };
}

export async function sessionOf(app: App, raw: string | undefined) {
  if (!raw) return null;
  const row = await one<Admin & { stage: Stage; token_hash: string }>(
    app.db,
    `select ${COLS}, s.stage, s.token_hash from admin_sessions s join admins a on a.id = s.admin_id
     where s.token_hash = $1 and s.expires_at > now() and a.disabled_at is null`,
    [sha256(raw)],
  );
  if (!row) return null;
  const { stage, token_hash, ...admin } = row;
  return { admin: admin as Admin, stage, tokenHash: token_hash };
}

export async function logout(app: App, raw: string | undefined) {
  if (raw) await app.db.query(`delete from admin_sessions where token_hash = $1`, [sha256(raw)]);
}

/** A fresh secret for the authenticator app; replaced each time until a code confirms it. */
export async function startEnroll(app: App, admin: Admin) {
  if (admin.totp_enabled_at) throw new ApiError(409, "already_enrolled", "Two-step sign-in is already set up.");
  const secret = newSecret();
  await app.db.query(`update admins set totp_secret_enc = $2 where id = $1`, [admin.id, seal(app.cfg.masterKey, secret)]);
  return { secret, otpauth_url: otpauthUrl(secret, admin.email) };
}

const codeTries = new Map<string, number>();

async function checkCode(app: App, admin: Admin, tokenHash: string, code: string) {
  const tries = codeTries.get(tokenHash) ?? 0;
  if (tries >= 5) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Sign in again.", "rate_limit_error");
  const r = await one<{ totp_secret_enc: string | null; totp_last_step: number | null }>(app.db, `select totp_secret_enc, totp_last_step from admins where id = $1`, [admin.id]);
  if (!r?.totp_secret_enc) throw new ApiError(409, "not_enrolled", "Set up your authenticator app first.");
  const step = verifyTotp(open(app.cfg.masterKey, r.totp_secret_enc), code.trim(), r.totp_last_step === null ? null : Number(r.totp_last_step));
  if (step === null) {
    codeTries.set(tokenHash, tries + 1);
    throw new ApiError(400, "wrong_code", "That code doesn't match. Use the current code from your authenticator app.");
  }
  codeTries.delete(tokenHash);
  return step;
}

/** Confirms the authenticator app (first sign-in) or the code (every sign-in after) and swaps in a full session. */
export async function completeSignIn(app: App, admin: Admin, stage: Stage, tokenHash: string, code: string, ip?: string, ua?: string) {
  const step = await checkCode(app, admin, tokenHash, code);
  return app.db.tx(async (q) => {
    if (stage === "enroll") await q.query(`update admins set totp_enabled_at = now() where id = $1`, [admin.id]);
    await q.query(`update admins set totp_last_step = $2, last_login_at = now() where id = $1`, [admin.id, step]);
    await q.query(`delete from admin_sessions where token_hash = $1`, [tokenHash]);
    await audit(q, admin.id, stage === "enroll" ? "admin.2fa_enabled" : "admin.login", { type: "admin", id: admin.id }, {}, ip);
    return createSession(q, admin.id, "full", ip, ua);
  });
}

// ---------- team ----------

const ownerOnly = (actor: Admin) => {
  if (actor.role !== "owner") throw new ApiError(403, "owner_only", "Only the owner can manage admin accounts.", "permission_error");
};

export async function list(app: App) {
  const { rows } = await app.db.query<Admin>(`select ${COLS} from admins a order by a.created_at`);
  return rows;
}

export async function create(app: App, actor: Admin, input: { name: string; email: string; password: string; role: "owner" | "admin" }, ip?: string) {
  ownerOnly(actor);
  if (input.password.length < 12) throw new ApiError(400, "weak_password", "Use at least 12 characters.");
  const hash = await hashPassword(input.password);
  return app.db.tx(async (q) => {
    const email = input.email.trim().toLowerCase();
    if (await one(q, `select 1 from admins where email = $1`, [email])) throw new ApiError(409, "email_taken", "An admin with this email already exists.");
    const id = newId("adm");
    await q.query(`insert into admins (id, email, name, password_hash, role) values ($1,$2,$3,$4,$5)`, [id, email, input.name.trim(), hash, input.role]);
    await audit(q, actor.id, "admin.created", { type: "admin", id }, { email, role: input.role }, ip);
    return { id };
  });
}

export async function setDisabled(app: App, actor: Admin, id: string, disabled: boolean, ip?: string) {
  ownerOnly(actor);
  if (id === actor.id) throw new ApiError(400, "self", "You can't disable your own account.");
  await app.db.tx(async (q) => {
    const { rows } = await q.query(`update admins set disabled_at = ${disabled ? "now()" : "null"} where id = $1 returning id`, [id]);
    if (!rows.length) throw new ApiError(404, "not_found", "No such admin.", "not_found");
    if (disabled) await q.query(`delete from admin_sessions where admin_id = $1`, [id]);
    await audit(q, actor.id, disabled ? "admin.disabled" : "admin.enabled", { type: "admin", id }, {}, ip);
  });
}

/** For a lost phone: the admin sets up their authenticator again at next sign-in. */
export async function resetTwoFactor(app: App, actor: Admin, id: string, ip?: string) {
  ownerOnly(actor);
  await app.db.tx(async (q) => {
    const { rows } = await q.query(`update admins set totp_enabled_at = null, totp_secret_enc = null, totp_last_step = null where id = $1 returning id`, [id]);
    if (!rows.length) throw new ApiError(404, "not_found", "No such admin.", "not_found");
    await q.query(`delete from admin_sessions where admin_id = $1`, [id]);
    await audit(q, actor.id, "admin.2fa_reset", { type: "admin", id }, {}, ip);
  });
}
