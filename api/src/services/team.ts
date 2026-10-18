import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, hashPassword, newId, normalisePhone, sha256, token } from "../lib.js";
import type { Role, User } from "./accounts.js";
import { checkPassword, record, type Ctx } from "./security.js";

// People on one merchant account. The owner invites by link; each role sees
// everything but can only change what its job needs.

export type Perm = "collect" | "money" | "developers" | "settings" | "team";
export const INVITABLE = ["admin", "developer", "finance", "support"] as const;

const GRANTS: Record<Role, Perm[]> = {
  owner: ["collect", "money", "developers", "settings", "team"],
  admin: ["collect", "money", "developers", "settings"],
  developer: ["developers"],
  finance: ["collect", "money"],
  support: [],
};

export const permissionsOf = (role: Role): Perm[] => GRANTS[role] ?? [];
export const can = (role: Role, perm: Perm) => permissionsOf(role).includes(perm);

const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", developer: "Developer", finance: "Finance", support: "Support" };
const INVITE_DAYS = 7;

export async function members(app: App, merchantId: string) {
  const { rows: people } = await app.db.query(
    `select id, email, first_name, last_name, role, totp_enabled_at is not null as two_factor, created_at,
            (select max(coalesce(s.last_seen_at, s.created_at)) from sessions s where s.user_id = u.id) as last_active_at
     from users u where merchant_id = $1 and disabled_at is null order by (role = 'owner') desc, created_at`,
    [merchantId],
  );
  const { rows: invites } = await app.db.query(
    `select id, email, role, created_at, expires_at from invites where merchant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc`,
    [merchantId],
  );
  return { members: people, invites };
}

/** Returns the link once; only its hash is stored. */
export async function invite(app: App, owner: User, input: { email: string; role: (typeof INVITABLE)[number] }, ctx: Ctx) {
  const email = input.email.trim().toLowerCase();
  const existing = await one<{ merchant_id: string; disabled_at: string | null }>(app.db, `select merchant_id, disabled_at from users where email = $1`, [email]);
  if (existing && !(existing.merchant_id === owner.merchant_id && existing.disabled_at))
    throw new ApiError(409, "email_taken", existing.merchant_id === owner.merchant_id ? "They're already on your team." : "This email already has its own SwiftPal account. Invite a different email.");
  const pending = await one<{ n: number }>(app.db, `select count(*)::int as n from invites where merchant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()`, [owner.merchant_id]);
  if ((pending?.n ?? 0) >= 20) throw new ApiError(429, "too_many_invites", "Revoke some pending invites first.", "rate_limit_error");

  const raw = token(24);
  const id = newId("inv");
  await app.db.tx(async (q) => {
    await q.query(`update invites set revoked_at = now() where merchant_id = $1 and email = $2 and accepted_at is null and revoked_at is null`, [owner.merchant_id, email]);
    await q.query(`insert into invites (id, token_hash, merchant_id, email, role, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)`, [
      id,
      sha256(raw),
      owner.merchant_id,
      email,
      input.role,
      owner.id,
      String(INVITE_DAYS),
    ]);
    await record(q, owner.merchant_id, owner.id, "member_invited", { email, role: input.role }, ctx);
  });
  const url = `${app.cfg.webUrl}/invite?token=${raw}`;
  const m = await one<{ name: string }>(app.db, `select name from merchants where id = $1`, [owner.merchant_id]);
  await app.mail
    .send(email, `Join ${m?.name ?? "a business"} on SwiftPal`, `${owner.first_name} ${owner.last_name} invited you to ${m?.name} on SwiftPal as ${ROLE_NAME[input.role]}.\n\nAccept within ${INVITE_DAYS} days:\n${url}`)
    .catch(() => {});
  return { id, invite_url: url, expires_in_days: INVITE_DAYS };
}

export async function revokeInvite(app: App, owner: User, id: string, ctx: Ctx) {
  await app.db.tx(async (q) => {
    const { rows } = await q.query(`update invites set revoked_at = now() where id = $1 and merchant_id = $2 and accepted_at is null and revoked_at is null returning email`, [id, owner.merchant_id]);
    if (!rows.length) throw new ApiError(404, "not_found", "No such invite.", "not_found");
    await record(q, owner.merchant_id, owner.id, "invite_revoked", { email: rows[0].email }, ctx);
  });
}

async function openInvite(app: App, raw: string) {
  return one<{ id: string; merchant_id: string; email: string; role: Role; merchant_name: string; inviter: string | null }>(
    app.db,
    `select i.id, i.merchant_id, i.email, i.role, m.name as merchant_name, u.first_name || ' ' || u.last_name as inviter
     from invites i join merchants m on m.id = i.merchant_id left join users u on u.id = i.invited_by
     where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and m.suspended_at is null`,
    [sha256(raw)],
  );
}

export async function describeInvite(app: App, raw: string) {
  const i = await openInvite(app, raw);
  if (!i) throw new ApiError(404, "invite_invalid", "This invite has expired or was already used. Ask for a new one.", "not_found");
  return { email: i.email, role: i.role, role_name: ROLE_NAME[i.role], business: i.merchant_name, invited_by: i.inviter };
}

export async function accept(app: App, raw: string, input: { firstName: string; lastName: string; phone: string; password: string }, ctx: Ctx) {
  const i = await openInvite(app, raw);
  if (!i) throw new ApiError(404, "invite_invalid", "This invite has expired or was already used. Ask for a new one.", "not_found");
  const phone = normalisePhone(input.phone);
  if (!phone) throw new ApiError(400, "invalid_phone", "Enter a Safaricom number, e.g. 0712 345 678.");
  checkPassword(input.password, i.email);
  const hash = await hashPassword(input.password);
  return app.db.tx(async (q) => {
    const claimed = await q.query(`update invites set accepted_at = now() where id = $1 and accepted_at is null returning id`, [i.id]);
    if (!claimed.rows.length) throw new ApiError(409, "invite_used", "This invite was just used.");
    const prior = await one<{ id: string; merchant_id: string; disabled_at: string | null }>(q, `select id, merchant_id, disabled_at from users where email = $1 for update`, [i.email]);
    if (prior && !(prior.merchant_id === i.merchant_id && prior.disabled_at)) throw new ApiError(409, "email_taken", "This email already has a SwiftPal account. Sign in instead.");
    // The link was addressed to this email and opened by them, so the email counts as proved.
    const verified = app.cfg.codes ? null : new Date().toISOString();
    let userId: string;
    if (prior) {
      userId = prior.id;
      await q.query(
        `update users set first_name = $2, last_name = $3, phone = $4, password_hash = $5, role = $6, disabled_at = null, email_verified_at = now(), phone_verified_at = $7,
         totp_secret_enc = null, totp_pending_enc = null, totp_enabled_at = null, totp_last_step = null where id = $1`,
        [userId, input.firstName.trim(), input.lastName.trim(), phone, hash, i.role, verified],
      );
    } else {
      userId = newId("usr");
      await q.query(
        `insert into users (id, merchant_id, email, phone, first_name, last_name, password_hash, role, email_verified_at, phone_verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)`,
        [userId, i.merchant_id, i.email, phone, input.firstName.trim(), input.lastName.trim(), hash, i.role, verified],
      );
    }
    await record(q, i.merchant_id, userId, "member_joined", { role: i.role }, ctx);
    return { userId };
  });
}

function assertManageable(owner: User, target: { id: string; role: Role } | null) {
  if (!target) throw new ApiError(404, "not_found", "No such team member.", "not_found");
  if (target.id === owner.id) throw new ApiError(400, "self", "You can't change your own access.");
  if (target.role === "owner") throw new ApiError(400, "owner", "The owner's access can't be changed.");
}

export async function setRole(app: App, owner: User, userId: string, role: (typeof INVITABLE)[number], ctx: Ctx) {
  await app.db.tx(async (q) => {
    const t = await one<{ id: string; role: Role; email: string }>(q, `select id, role, email from users where id = $1 and merchant_id = $2 and disabled_at is null for update`, [userId, owner.merchant_id]);
    assertManageable(owner, t);
    await q.query(`update users set role = $2 where id = $1`, [userId, role]);
    await record(q, owner.merchant_id, owner.id, "member_role_changed", { email: t!.email, from: t!.role, to: role }, ctx);
  });
}

/** Removed members are signed out at once; their history stays. */
export async function remove(app: App, owner: User, userId: string, ctx: Ctx) {
  await app.db.tx(async (q) => {
    const t = await one<{ id: string; role: Role; email: string }>(q, `select id, role, email from users where id = $1 and merchant_id = $2 and disabled_at is null for update`, [userId, owner.merchant_id]);
    assertManageable(owner, t);
    await q.query(`update users set disabled_at = now() where id = $1`, [userId]);
    await q.query(`delete from sessions where user_id = $1`, [userId]);
    await record(q, owner.merchant_id, owner.id, "member_removed", { email: t!.email, role: t!.role }, ctx);
  });
}
