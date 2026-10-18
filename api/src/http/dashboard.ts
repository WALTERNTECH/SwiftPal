import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import { NAIROBI_TODAY, one } from "../db.js";
import { ApiError, kes, sha256 } from "../lib.js";
import { limit } from "../limits.js";
import * as accounts from "../services/accounts.js";
import type { User } from "../services/accounts.js";
import { analytics } from "../services/analytics.js";
import * as channels from "../services/channels.js";
import * as connect from "../services/connect.js";
import * as exportsCsv from "../services/exports.js";
import * as links from "../services/links.js";
import { createStk, createTopup, getPayment, listPayments, presentPayment } from "../services/payments.js";
import * as otp from "../services/otp.js";
import { createBatch, createPayout, listPayouts, presentPayout, REASONS, refundPayment, refundsOf } from "../services/payouts.js";
import * as platform from "../services/platform.js";
import * as sandbox from "../services/sandbox.js";
import * as security from "../services/security.js";
import * as team from "../services/team.js";
import * as verification from "../services/verification.js";
import * as webhooks from "../services/webhooks.js";
import { present, read } from "../services/wallet.js";
import { metadata, modeOf, pageSize, parse, phone } from "./common.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

const COOKIE = "sp_session";
const HOUR = 3_600_000;

function cookieOf(req: FastifyRequest) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setCookie(app: App, reply: FastifyReply, value: string, maxAge: number) {
  const secure = app.cfg.env === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

const ctx = (req: FastifyRequest): security.Ctx => ({ ip: req.clientIp, ua: req.headers["user-agent"] });
const code6 = z.string().regex(/^\d{6}$/, "must be 6 digits");

/**
 * What each role may change. Every member can read the account; these rules
 * gate the rest. Keys, webhooks and logs carry secrets, so even reading them
 * is for developers.
 */
const RULES: { methods: string[] | "*"; path: RegExp; perm: team.Perm }[] = [
  { methods: "*", path: /^\/app\/(keys|webhooks|logs|connect)(\/|$)/, perm: "developers" },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/app\/(payouts|wallet|confirmations)(\/|$)/, perm: "money" },
  { methods: ["POST"], path: /^\/app\/payments\/[^/]+\/refund$/, perm: "money" },
  { methods: ["POST"], path: /^\/app\/payments$/, perm: "collect" },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/app\/links(\/|$)/, perm: "collect" },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/app\/(merchant|channels|verification|sandbox)(\/|$)/, perm: "settings" },
  { methods: "*", path: /^\/app\/activity$/, perm: "settings" },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/app\/team(\/|$)/, perm: "team" },
];

const ROLE_NAME: Record<accounts.Role, string> = { owner: "Owner", admin: "Admin", developer: "Developer", finance: "Finance", support: "Support" };

const twoFactorRequired = (what: string) =>
  new ApiError(403, "two_factor_required", `Turn on two-step verification in Settings → Security ${what}.`, "permission_error");

export function dashboardRoutes(api: FastifyInstance, app: App) {
  api.register(
    async (r) => {
      // ---------- auth (no session needed) ----------
      r.post("/auth/signup", async (req, reply) => {
        await platform.assertSignupsOpen(app);
        // Generous per address: mobile networks put many people behind one IP.
        limit(`signup:${req.clientIp}`, 20, HOUR, "Too many sign-ups from this network. Try again in an hour.");
        const b = parse(
          z.object({ first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), email: z.email().max(200), phone: z.string().max(20), password: z.string().min(10).max(200) }),
          req.body,
        );
        const { user, session } = await accounts.signUp(app, { firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone, password: b.password, ip: req.clientIp, ua: req.headers["user-agent"] });
        setCookie(app, reply, session, 30 * 86400);
        return reply.code(201).send({ user });
      });

      // Password first; with an authenticator app or a verified phone, a pending session waits for the code.
      r.post("/auth/login", async (req, reply) => {
        const b = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), req.body);
        const { user, session, otp: second } = await accounts.signIn(app, { ...b, ip: req.clientIp, ua: req.headers["user-agent"] });
        setCookie(app, reply, session, second ? 15 * 60 : 30 * 86400);
        return second ? { otp_required: true, ...second } : { otp_required: false, user };
      });

      r.post("/auth/login/verify", async (req, reply) => {
        limit(`login-verify:${req.clientIp}`, 30, 10 * 60_000, "Too many attempts. Try again in a few minutes.");
        const b = parse(z.object({ code: z.string().trim().min(6).max(12) }), req.body);
        const { user, session } = await accounts.completeLogin(app, cookieOf(req), b.code, req.clientIp, req.headers["user-agent"]);
        setCookie(app, reply, session, 30 * 86400);
        return { user };
      });

      r.post("/auth/login/resend", async (req) => accounts.resendLoginCode(app, cookieOf(req)));

      r.post("/auth/forgot", async (req) => {
        const b = parse(z.object({ email: z.string().max(200) }), req.body);
        limit(`forgot:ip:${req.clientIp}`, 10, HOUR, "Too many reset requests. Try again in an hour.");
        limit(`forgot:email:${b.email.trim().toLowerCase()}`, 3, HOUR, "Too many reset requests. Try again in an hour.");
        await accounts.requestReset(app, b.email);
        return { ok: true };
      });

      r.post("/auth/reset", async (req) => {
        limit(`reset:${req.clientIp}`, 10, HOUR, "Too many attempts. Try again in an hour.");
        const b = parse(z.object({ token: z.string().min(20).max(100), password: z.string().min(10).max(200) }), req.body);
        await accounts.resetPassword(app, b.token, b.password, ctx(req));
        return { ok: true };
      });

      r.post("/auth/logout", async (req, reply) => {
        await accounts.signOut(app, cookieOf(req));
        setCookie(app, reply, "", 0);
        return { ok: true };
      });

      // Team invites: the token comes in the body, never the URL, so it stays out of request logs.
      r.post("/auth/invite/describe", async (req) => {
        limit(`invite:${req.clientIp}`, 30, 10 * 60_000);
        const b = parse(z.object({ token: z.string().min(20).max(100) }), req.body);
        return team.describeInvite(app, b.token);
      });
      r.post("/auth/invite/accept", async (req, reply) => {
        limit(`invite-accept:${req.clientIp}`, 10, HOUR, "Too many attempts. Try again in an hour.");
        const b = parse(
          z.object({ token: z.string().min(20).max(100), first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), phone: z.string().max(20), password: z.string().min(10).max(200) }),
          req.body,
        );
        const { userId } = await team.accept(app, b.token, { firstName: b.first_name, lastName: b.last_name, phone: b.phone, password: b.password }, ctx(req));
        const session = await accounts.openSession(app, userId, req.clientIp, req.headers["user-agent"]);
        setCookie(app, reply, session, 30 * 86400);
        return reply.code(201).send({ ok: true });
      });

      // ---------- everything below needs a session ----------
      r.register(async (s) => {
        s.addHook("onRequest", async (req) => {
          // SameSite=Lax stops cross-site POSTs carrying the cookie; this header stops simple forms too.
          if (req.method !== "GET" && req.headers["x-requested-with"] !== "SwiftPal") throw new ApiError(403, "csrf", "Missing X-Requested-With header.", "permission_error");
          const user = await accounts.sessionUser(app, cookieOf(req));
          if (!user) throw new ApiError(401, "not_signed_in", "Sign in to continue.", "authentication_error");
          req.user = user;
          limit(`dash:${user.id}`, 600, 60_000, "Too many requests. Slow down for a minute.");
          const path = req.url.split("?")[0];
          if (app.cfg.codes && !user.phone_verified_at && !["/app/auth/verify-phone", "/app/auth/resend-phone", "/app/me"].includes(path))
            throw new ApiError(403, "phone_unverified", "Verify your phone number first.", "permission_error");
          if (app.cfg.codes && user.phone_verified_at && !user.email_verified_at && !["/app/auth/verify-email", "/app/auth/resend", "/app/me"].includes(path))
            throw new ApiError(403, "email_unverified", "Verify your email first.", "permission_error");
          const rule = RULES.find((x) => (x.methods === "*" || x.methods.includes(req.method)) && x.path.test(path));
          if (rule && !team.can(user.role, rule.perm))
            throw new ApiError(403, "role_forbidden", `Your role (${ROLE_NAME[user.role] ?? user.role}) can't do this. Ask the account owner.`, "permission_error");
        });
        const merchant = (req: FastifyRequest) => accounts.getMerchant(app.db, req.user!.merchant_id);
        const mid = (req: FastifyRequest) => req.user!.merchant_id;
        const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

        s.post("/auth/verify-phone", async (req) => {
          const b = parse(z.object({ code: code6 }), req.body);
          return { user: await accounts.verifyPhone(app, req.user!.id, b.code) };
        });
        s.post("/auth/resend-phone", async (req) => accounts.resendPhoneCode(app, req.user!.id));

        s.post("/auth/verify-email", async (req) => {
          const b = parse(z.object({ code: code6 }), req.body);
          return { user: await accounts.verifyEmail(app, req.user!.id, b.code) };
        });
        s.post("/auth/resend", async (req) => {
          await accounts.resendCode(app, req.user!.id);
          return { ok: true };
        });

        s.get("/me", async (req) => {
          const m = await merchant(req);
          const owner = req.user!.role === "owner" ? req.user! : await accounts.ownerOf(app.db, m.id);
          const limitCents = Number(m.payout_daily_limit_cents ?? app.cfg.payoutDailyLimitCents);
          const today = await one<{ sent: number }>(
            app.db,
            `select coalesce(sum(amount), 0) as sent from payouts where merchant_id = $1 and mode = 'live' and status not in ('failed','reversed')
             and created_at >= ${NAIROBI_TODAY}`,
            [m.id],
          );
          return {
            user: { ...req.user, two_factor: !!req.user!.totp_enabled_at },
            permissions: team.permissionsOf(req.user!.role),
            merchant: { ...m, low_balance_at: kes(m.low_balance_at_cents) },
            balances: { test: present(await read(app.db, m.id, "test")), live: present(await read(app.db, m.id, "live")) },
            channels: (await channels.listChannels(app, m.id)).map(channels.presentChannel),
            verification: await verification.current(app, m.id),
            live_available: !!app.mpesa.live,
            codes: app.cfg.codes,
            announcement: (await platform.settings(app)).announcement,
            limits: { payout_daily: kes(limitCents), sent_today: Number(today?.sent ?? 0) },
            pricing: { stk_fee: m.stk_fee_cents === null ? null : kes(Number(m.stk_fee_cents)), b2c_fee_pct: m.b2c_fee_pct },
            withdraw_to: otp.maskPhone(owner.phone),
            pending: Object.fromEntries(
              (
                await app.db.query<{ mode: string; n: number }>(
                  `select mode, count(*)::int as n from payments where merchant_id = $1 and purpose = 'charge' and status in ('pending','confirming') group by mode`,
                  [m.id],
                )
              ).rows.map((row) => [row.mode, Number(row.n)]),
            ),
          };
        });

        s.patch("/me", async (req) => {
          // The phone number changes only through /me/phone, with a code to each number.
          const b = parse(z.object({ first_name: z.string().trim().min(1).max(60).optional(), last_name: z.string().trim().min(1).max(60).optional() }), req.body);
          await app.db.query(`update users set first_name = coalesce($2, first_name), last_name = coalesce($3, last_name) where id = $1`, [
            req.user!.id,
            b.first_name ?? null,
            b.last_name ?? null,
          ]);
          return { ok: true };
        });

        s.post("/me/phone", async (req) => {
          const b = parse(z.object({ phone }), req.body);
          return accounts.startPhoneChange(app, req.user!, b.phone);
        });
        s.post("/me/phone/confirm", async (req) => {
          const b = parse(z.object({ phone, current_code: code6, new_code: code6 }), req.body);
          if (!app.cfg.codes) throw new ApiError(403, "phone_change_unavailable", "Contact support to change your number.", "permission_error");
          await accounts.confirmPhoneChange(app, req.user!, b.phone, b.current_code, b.new_code);
          return { ok: true };
        });

        // ---------- the person's own security ----------
        s.get("/security", async (req) => {
          const pw = await one<{ password_changed_at: string | null }>(app.db, `select password_changed_at from users where id = $1`, [req.user!.id]);
          return {
            two_factor: await security.twoFactorStatus(app, req.user!.id),
            sessions: await security.listSessions(app, req.user!.id, cookieOf(req)!),
            password_changed_at: pw?.password_changed_at ?? null,
          };
        });
        s.post("/security/password", async (req) => {
          const b = parse(z.object({ current_password: z.string().max(200), new_password: z.string().min(10).max(200) }), req.body);
          await security.changePassword(app, req.user!, b.current_password, b.new_password, cookieOf(req)!, ctx(req));
          return { ok: true };
        });
        s.post("/security/2fa/setup", async (req) => security.startTwoFactor(app, req.user!));
        s.post("/security/2fa/enable", async (req) => security.enableTwoFactor(app, req.user!, parse(z.object({ code: code6 }), req.body).code, ctx(req)));
        s.post("/security/2fa/disable", async (req) => {
          const b = parse(z.object({ password: z.string().max(200), code: code6 }), req.body);
          await security.disableTwoFactor(app, req.user!, b.password, b.code, ctx(req));
          return { ok: true };
        });
        s.post("/security/2fa/recovery-codes", async (req) => security.regenerateRecoveryCodes(app, req.user!, parse(z.object({ code: code6 }), req.body).code, ctx(req)));
        s.delete("/security/sessions/:id", async (req) => {
          await security.revokeSession(app, req.user!, idOf(req), ctx(req));
          return { ok: true };
        });
        s.post("/security/sessions/sign-out-others", async (req) => {
          await security.revokeOtherSessions(app, req.user!, cookieOf(req)!, ctx(req));
          return { ok: true };
        });
        s.get("/activity", async (req) => security.activity(app, mid(req)));

        // ---------- step-up: the second factor before live money or money-moving credentials ----------
        /** With an authenticator app the code is checked; without one, moving money needs it turned on. */
        async function credentialStepUp(req: FastifyRequest, movesMoney: boolean, code: string | undefined) {
          if (req.user!.totp_enabled_at) {
            await security.verifySecondFactor(app, req.user!, code, ctx(req));
            return;
          }
          if (movesMoney) throw twoFactorRequired("to create keys that can send money");
        }

        s.post("/confirmations", async (req) => {
          const a = parse(confirmable, req.body);
          if (a.mode === "test") return { required: false };
          await precheck(req, a);
          if (req.user!.totp_enabled_at) return { required: true, method: "totp" };
          if (!app.cfg.codes) throw twoFactorRequired("before money can leave your account");
          const { purpose, payload, text } = describe(a, await withdrawPhone(req));
          return { required: true, method: "sms", ...(await otp.issue(app, { userId: req.user!.id, purpose, phone: req.user!.phone, payload, text })) };
        });
        /** Refuses before any code is asked for when the money couldn't move anyway. */
        async function precheck(req: FastifyRequest, a: Confirmable) {
          if (!app.mpesa.live) throw new ApiError(503, "live_not_configured", "Live M-Pesa is not configured on this server yet.", "api_error");
          await platform.assertPayoutsOpen(app);
          const m = await merchant(req);
          accounts.assertActive(m);
          if (a.action !== "withdraw" && m.verification_status !== "approved")
            throw new ApiError(403, "payouts_not_enabled", "B2C needs a verified account. Complete Verification in the dashboard.", "permission_error");
          const need = a.action === "batch" ? a.items.reduce((t, i) => t + i.amount, 0) : a.amount;
          const float = (await read(app.db, m.id, "live")).float.available / 100;
          if (float < need) throw new ApiError(409, "insufficient_float", `Payout float is ${money(float)} and this needs ${money(need)}.`, "balance_error");
        }
        /** Uses the code a live dashboard payout, refund or withdrawal was confirmed with. */
        async function confirm(req: FastifyRequest, a: Confirmable, code: string | undefined) {
          if (a.mode === "test") return;
          await precheck(req, a);
          if (req.user!.totp_enabled_at) {
            await security.verifySecondFactor(app, req.user!, code, ctx(req));
            return;
          }
          if (!app.cfg.codes) throw twoFactorRequired("before money can leave your account");
          const d = describe(a, await withdrawPhone(req));
          await otp.check(app, { userId: req.user!.id, purpose: d.purpose, code, payload: d.payload });
        }
        const withdrawPhone = async (req: FastifyRequest) => (req.user!.role === "owner" ? req.user!.phone : (await accounts.ownerOf(app.db, mid(req))).phone);

        s.patch("/merchant", async (req) => {
          const b = parse(
            z.object({
              name: z.string().trim().min(2).max(120).optional(),
              type: z.enum(["individual", "company", "ngo"]).optional(),
              industry: z.string().max(80).optional(),
              monthly_volume: z.string().max(40).optional(),
              website: z.string().max(200).optional(),
              onboarding_done: z.boolean().optional(),
              auto_cover: z.boolean().optional(),
              low_balance_at: z.number().min(0).max(1_000_000).optional(),
            }),
            req.body,
          );
          await app.db.query(
            `update merchants set name = coalesce($2,name), type = coalesce($3,type), industry = coalesce($4,industry), monthly_volume = coalesce($5,monthly_volume),
             website = coalesce($6,website), onboarding_done = coalesce($7,onboarding_done), auto_cover = coalesce($8,auto_cover),
             low_balance_at_cents = coalesce($9,low_balance_at_cents) where id = $1`,
            [mid(req), b.name ?? null, b.type ?? null, b.industry ?? null, b.monthly_volume ?? null, b.website ?? null, b.onboarding_done ?? null, b.auto_cover ?? null, b.low_balance_at === undefined ? null : Math.round(b.low_balance_at * 100)],
          );
          return { ok: true };
        });

        // ---------- channels ----------
        s.get("/channels", async (req) => (await channels.listChannels(app, mid(req))).map(channels.presentChannel));
        s.post("/channels", async (req, reply) => {
          const b = parse(
            z.object({
              kind: z.enum(["till", "paybill"]),
              shortcode: z.string().max(20),
              account_number: z.string().max(40).optional(),
              display_name: z.string().max(80),
              business_shortcode: z.string().max(20).optional(),
              passkey: z.string().max(200).optional(),
            }),
            req.body,
          );
          const ch = await channels.addChannel(app, await merchant(req), {
            kind: b.kind,
            shortcode: b.shortcode,
            accountNumber: b.account_number,
            displayName: b.display_name,
            businessShortcode: b.business_shortcode,
            passkey: b.passkey,
          });
          await security.record(app.db, mid(req), req.user!.id, "channel_added", { kind: b.kind, shortcode: b.shortcode }, ctx(req));
          return reply.code(201).send(channels.presentChannel(ch));
        });
        s.post("/channels/:id/default", async (req) => {
          await channels.setDefaultChannel(app, mid(req), idOf(req));
          return { ok: true };
        });
        s.delete("/channels/:id", async (req) => {
          await channels.removeChannel(app, mid(req), idOf(req));
          await security.record(app.db, mid(req), req.user!.id, "channel_removed", { channel: idOf(req) }, ctx(req));
          return { ok: true };
        });

        // ---------- connecting an assistant or CLI ----------
        s.get("/connect/:code", async (req) => connect.describe(app, (req.params as { code: string }).code));
        s.post("/connect/:code/approve", async (req) => {
          // Payouts are opt-in: a phished approval should at most be able to request payments.
          const b = parse(z.object({ scopes: z.array(z.string().max(40)).min(1).max(5).default(["payments:write", "read"]), code: z.string().max(12).optional() }), req.body ?? {});
          await credentialStepUp(req, b.scopes.includes("payouts:write"), b.code);
          return connect.approve(app, mid(req), req.user!.id, (req.params as { code: string }).code, b.scopes, ctx(req));
        });
        s.post("/connect/:code/deny", async (req) => {
          await connect.deny(app, (req.params as { code: string }).code);
          return { ok: true };
        });

        // ---------- keys ----------
        s.get("/keys", async (req) => accounts.listKeys(app, mid(req)));
        s.post("/keys", async (req, reply) => {
          const b = parse(z.object({ name: z.string().max(60), mode: z.enum(["test", "live"]), scopes: z.array(z.string().max(40)).min(1).max(5), code: z.string().max(12).optional() }), req.body);
          if (b.mode === "live") await credentialStepUp(req, b.scopes.includes("payouts:write"), b.code);
          const out = await accounts.createKey(app, await merchant(req), b.mode, b.name, b.scopes);
          await security.record(app.db, mid(req), req.user!.id, "key_created", { key: out.id, name: b.name.trim(), mode: b.mode, scopes: b.scopes }, ctx(req));
          return reply.code(201).send(out);
        });
        s.post("/keys/:id/roll", async (req) => {
          const k = await one<{ mode: string; scopes: string[]; name: string }>(app.db, `select mode, scopes, name from api_keys where id = $1 and merchant_id = $2 and revoked_at is null`, [idOf(req), mid(req)]);
          if (!k) throw new ApiError(404, "not_found", "No such key.", "not_found");
          if (k.mode === "live") await credentialStepUp(req, k.scopes.includes("payouts:write"), parse(z.object({ code: z.string().max(12).optional() }), req.body ?? {}).code);
          const out = await accounts.rollKey(app, mid(req), idOf(req));
          await security.record(app.db, mid(req), req.user!.id, "key_rolled", { key: idOf(req), name: k.name, mode: k.mode }, ctx(req));
          return out;
        });
        s.delete("/keys/:id", async (req) => {
          await accounts.revokeKey(app, mid(req), idOf(req));
          await security.record(app.db, mid(req), req.user!.id, "key_revoked", { key: idOf(req) }, ctx(req));
          return { ok: true };
        });

        // ---------- webhooks ----------
        s.get("/webhooks", async (req) => webhooks.listEndpoints(app, mid(req), modeOf(req)));
        s.post("/webhooks", async (req, reply) => {
          const b = parse(z.object({ url: z.string().max(500), events: z.array(z.string().max(60)).min(1).max(30), mode: z.enum(["test", "live"]) }), req.body);
          const out = await webhooks.addEndpoint(app, mid(req), b.mode, b.url, b.events);
          await security.record(app.db, mid(req), req.user!.id, "webhook_added", { url: b.url, mode: b.mode }, ctx(req));
          return reply.code(201).send(out);
        });
        s.patch("/webhooks/:id", async (req) => {
          const b = parse(z.object({ enabled: z.boolean().optional(), events: z.array(z.string().max(60)).max(30).optional() }), req.body);
          await webhooks.updateEndpoint(app, mid(req), idOf(req), b);
          return { ok: true };
        });
        s.delete("/webhooks/:id", async (req) => {
          await webhooks.removeEndpoint(app, mid(req), idOf(req));
          await security.record(app.db, mid(req), req.user!.id, "webhook_removed", { endpoint: idOf(req) }, ctx(req));
          return { ok: true };
        });
        s.post("/webhooks/:id/test", async (req) => {
          limit(`webhook-test:${req.user!.id}`, 20, 10 * 60_000, "Too many test events. Wait a few minutes.");
          return webhooks.sendTest(app, mid(req), idOf(req));
        });
        s.get("/webhooks/deliveries", async (req) => webhooks.listDeliveries(app, mid(req), modeOf(req)));
        s.post("/webhooks/deliveries/:id/replay", async (req) => {
          await webhooks.replay(app, mid(req), idOf(req));
          return { ok: true };
        });

        // ---------- payments, refunds and payouts ----------
        s.get("/payments", async (req) => {
          const q = req.query as { status?: string; q?: string; limit?: string; before?: string };
          return (await listPayments(app, mid(req), modeOf(req), { status: q.status, q: q.q?.slice(0, 80), before: q.before, limit: pageSize(q.limit, 100, 200) })).map(presentPayment);
        });
        s.get("/payments/counts", async (req) => {
          const { rows } = await app.db.query<{ status: string; n: number }>(
            `select status, count(*)::int as n from payments where merchant_id = $1 and mode = $2 and purpose = 'charge' group by status`,
            [mid(req), modeOf(req)],
          );
          const n = (...st: string[]) => rows.filter((row) => st.includes(row.status)).reduce((a, row) => a + Number(row.n), 0);
          return { all: n("pending", "confirming", "succeeded", "failed", "cancelled", "expired"), succeeded: n("succeeded"), pending: n("pending", "confirming"), unpaid: n("failed", "cancelled", "expired") };
        });
        s.get("/payments/:id", async (req) => {
          const p = await getPayment(app, mid(req), idOf(req));
          if (!p) throw new ApiError(404, "not_found", "No such payment.", "not_found");
          return presentPayment(p);
        });
        s.get("/payments/:id/refunds", async (req) => refundsOf(app, mid(req), idOf(req)));
        s.post("/payments/:id/refund", async (req, reply) => {
          const b = parse(refundAction.extend({ code: z.string().max(12).optional() }), { ...(req.body as object), payment: idOf(req) });
          await confirm(req, b, b.code);
          const out = await refundPayment(app, await merchant(req), b.mode, b.payment, b.amount);
          await security.record(app.db, mid(req), req.user!.id, "refund_sent", { payment: b.payment, amount: b.amount, payout: out.id }, ctx(req));
          return reply.code(201).send(presentPayout(out));
        });
        s.post("/payments", async (req, reply) => {
          const b = parse(
            z.object({ mode: z.enum(["test", "live"]), phone, amount: z.number().int().min(1).max(250_000), reference: z.string().trim().min(1).max(12), channel: z.string().max(40).optional(), metadata }),
            req.body,
          );
          const { mode, ...input } = b;
          return reply.code(201).send(presentPayment(await createStk(app, await merchant(req), mode, input)));
        });
        s.get("/payouts", async (req) => {
          const q = req.query as { q?: string; limit?: string; before?: string };
          return (await listPayouts(app, mid(req), modeOf(req), { q: q.q?.slice(0, 80), before: q.before, limit: pageSize(q.limit, 100, 200) })).map(presentPayout);
        });
        s.get("/payouts/summary", async (req) => {
          const res = await app.db.query<{ sent: number; paid_out: string; failed: number }>(
            `select count(*) filter (where status = 'succeeded')::int as sent, coalesce(sum(amount) filter (where status = 'succeeded'), 0) as paid_out,
                    count(*) filter (where status in ('failed','reversed'))::int as failed
             from payouts where merchant_id = $1 and mode = $2 and purpose = 'payout'`,
            [mid(req), modeOf(req)],
          );
          const row = res.rows[0];
          return { sent: Number(row?.sent ?? 0), paid_out: Number(row?.paid_out ?? 0), failed: Number(row?.failed ?? 0) };
        });
        s.post("/payouts", async (req, reply) => {
          const b = parse(payoutAction.extend({ metadata, code: z.string().max(12).optional() }), req.body);
          const { mode, code, action: _a, ...input } = b;
          await confirm(req, b, code);
          return reply.code(201).send(presentPayout(await createPayout(app, await merchant(req), mode, input)));
        });
        s.post("/payouts/batches", async (req, reply) => {
          const b = parse(batchAction.extend({ reference: z.string().max(40).optional(), code: z.string().max(12).optional() }), req.body);
          await confirm(req, b, b.code);
          return reply.code(201).send(await createBatch(app, await merchant(req), b.mode, b.reference ?? null, b.items));
        });

        // ---------- payment links ----------
        const linkBody = z.object({
          title: z.string().trim().min(2).max(80),
          description: z.string().trim().max(300).nullish(),
          amount: z.number().int("must be whole shillings").min(1).max(250_000).nullish(),
          reference: z.string().trim().max(12, "at most 12 characters (M-Pesa's limit)").regex(/^[A-Za-z0-9 _-]*$/, "letters, numbers, spaces, - and _ only").optional(),
          channel: z.string().max(40).nullish(),
        });
        s.get("/links", async (req) => links.list(app, mid(req)));
        s.get("/links/:id", async (req) => links.get(app, mid(req), idOf(req)));
        s.post("/links", async (req, reply) => reply.code(201).send(await links.create(app, await merchant(req), req.user!.id, parse(linkBody, req.body), ctx(req))));
        s.patch("/links/:id", async (req) => {
          const b = parse(z.object({ active: z.boolean().optional(), title: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(300).nullish() }), req.body);
          return links.update(app, mid(req), req.user!.id, idOf(req), b, ctx(req));
        });

        // ---------- wallet ----------
        s.get("/wallet", async (req) => {
          const m = await merchant(req);
          return { ...present(await read(app.db, m.id, modeOf(req))), auto_cover: m.auto_cover, low_balance_at: kes(m.low_balance_at_cents) };
        });
        s.get("/ledger", async (req) => {
          const q = req.query as { account?: string };
          const params: unknown[] = [mid(req), modeOf(req)];
          let where = `merchant_id = $1 and mode = $2`;
          if (q.account === "fee" || q.account === "float") {
            params.push(q.account);
            where += ` and account = $3`;
          }
          const { rows } = await app.db.query(`select id, account, kind, amount_cents, ref, created_at from ledger_entries where ${where} order by created_at desc limit 200`, params);
          return rows.map((l) => ({ ...l, amount: kes(Number(l.amount_cents)) }));
        });
        s.post("/wallet/topups", async (req, reply) => {
          const b = parse(z.object({ mode: z.enum(["test", "live"]), account: z.enum(["fee", "float"]), amount: z.number().int(), phone }), req.body);
          return reply.code(201).send(presentPayment(await createTopup(app, await merchant(req), b.mode, b)));
        });
        // Withdrawals only ever go to the owner's verified number, whoever on the team asks.
        s.post("/wallet/withdraw", async (req, reply) => {
          const b = parse(withdrawAction.extend({ code: z.string().max(12).optional() }), req.body);
          await confirm(req, b, b.code);
          const to = await withdrawPhone(req);
          const p = await createPayout(app, await merchant(req), b.mode, { phone: to, amount: b.amount, reference: "WITHDRAWAL", reason: "withdrawal" }, "withdrawal");
          await security.record(app.db, mid(req), req.user!.id, "withdrawal_sent", { amount: b.amount, to: otp.maskPhone(to), payout: p.id }, ctx(req));
          return reply.code(201).send(presentPayout(p));
        });

        // ---------- statements ----------
        s.get("/exports/:kind", async (req, reply) => {
          limit(`export:${req.user!.id}`, 30, 10 * 60_000, "Too many downloads. Try again in a few minutes.");
          const kind = (req.params as { kind: string }).kind.replace(/\.csv$/, "");
          const q = req.query as { from?: string; to?: string };
          const range = exportsCsv.range(q.from, q.to);
          const mode = modeOf(req);
          const body =
            kind === "payments"
              ? await exportsCsv.payments(app, mid(req), mode, range)
              : kind === "payouts"
                ? await exportsCsv.payouts(app, mid(req), mode, range)
                : kind === "statement"
                  ? await exportsCsv.ledger(app, mid(req), mode, range)
                  : null;
          if (body === null) throw new ApiError(404, "not_found", "Exports are payments, payouts or statement.", "not_found");
          await security.record(app.db, mid(req), req.user!.id, "export_downloaded", { kind, from: range.from, to: range.to }, ctx(req));
          return reply
            .header("Content-Type", "text/csv; charset=utf-8")
            .header("Content-Disposition", `attachment; filename="${exportsCsv.filename(kind, range)}"`)
            .send(`\uFEFF${body}`);
        });

        // ---------- insight ----------
        s.get("/analytics", async (req) => {
          const days = Number((req.query as { days?: string }).days ?? 30);
          return analytics(app, mid(req), modeOf(req), [7, 14, 30, 60, 90].includes(days) ? days : 30);
        });
        s.get("/logs", async (req) => {
          const { rows } = await app.db.query(
            `select id, method, path, status, duration_ms, request_body, response_body, created_at from request_logs where merchant_id = $1 and mode = $2 order by created_at desc limit 100`,
            [mid(req), modeOf(req)],
          );
          return rows;
        });

        // ---------- team ----------
        s.get("/team", async (req) => team.members(app, mid(req)));
        s.post("/team/invites", async (req, reply) => {
          limit(`team-invite:${req.user!.id}`, 20, HOUR, "Too many invites. Try again in an hour.");
          const b = parse(z.object({ email: z.email().max(200), role: z.enum(team.INVITABLE) }), req.body);
          return reply.code(201).send(await team.invite(app, req.user!, b, ctx(req)));
        });
        s.delete("/team/invites/:id", async (req) => {
          await team.revokeInvite(app, req.user!, idOf(req), ctx(req));
          return { ok: true };
        });
        s.patch("/team/members/:id", async (req) => {
          const b = parse(z.object({ role: z.enum(team.INVITABLE) }), req.body);
          await team.setRole(app, req.user!, idOf(req), b.role, ctx(req));
          return { ok: true };
        });
        s.delete("/team/members/:id", async (req) => {
          await team.remove(app, req.user!, idOf(req), ctx(req));
          return { ok: true };
        });

        // ---------- verification ----------
        s.get("/verification", async (req) => verification.current(app, mid(req)));
        s.post("/verification", async (req, reply) => {
          const fields: Record<string, string> = {};
          const files: verification.Upload[] = [];
          for await (const part of req.parts()) {
            if (part.type === "file") {
              const bytes = await part.toBuffer();
              files.push({ docKey: part.fieldname, filename: part.filename, bytes });
            } else fields[part.fieldname] = String(part.value ?? "").slice(0, 200);
          }
          const kind = fields.kind === "business" ? "business" : "individual";
          const out = await verification.submit(app, await merchant(req), { kind, name: fields.name ?? "", idNumber: (fields.id_number ?? "").replace(/\D/g, ""), regNumber: fields.reg_number, kraPin: fields.kra_pin?.toUpperCase() }, files);
          await security.record(app.db, mid(req), req.user!.id, "verification_submitted", { kind }, ctx(req));
          return reply.code(201).send(out);
        });

        // ---------- test-mode data for the API's own suite ----------
        s.post("/sandbox/seed", async (req) => {
          await sandbox.seed(app, mid(req));
          return { ok: true };
        });
        s.post("/sandbox/reset", async (req) => {
          await sandbox.reset(app, mid(req));
          return { ok: true };
        });
      });
    },
    { prefix: "/app" },
  );
}

// ---------- actions that need the second factor in live mode ----------

const mode = z.enum(["test", "live"]);
const amount = z.number().int().min(10).max(250_000);
const withdrawAction = z.object({ action: z.literal("withdraw").default("withdraw"), mode, amount });
const payoutAction = z.object({ action: z.literal("payout").default("payout"), mode, phone, amount, reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS) });
const batchItem = z.object({ phone, amount, reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS) });
const batchAction = z.object({ action: z.literal("batch").default("batch"), mode, items: z.array(batchItem).min(1).max(1000) });
const refundAction = z.object({ action: z.literal("refund").default("refund"), mode, payment: z.string().min(1).max(64), amount });
const confirmable = z.discriminatedUnion("action", [
  withdrawAction.extend({ action: z.literal("withdraw") }),
  payoutAction.extend({ action: z.literal("payout") }),
  batchAction.extend({ action: z.literal("batch") }),
  refundAction.extend({ action: z.literal("refund") }),
]);
type Confirmable = z.infer<typeof withdrawAction> | z.infer<typeof payoutAction> | z.infer<typeof batchAction> | z.infer<typeof refundAction>;

const money = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/** The code's purpose, the exact request it is bound to, and the SMS that says what it approves. */
function describe(a: Confirmable, withdrawTo: string): { purpose: otp.Purpose; payload: string; text: (c: string) => string } {
  if (a.action === "withdraw") {
    return {
      purpose: "withdraw",
      payload: `withdraw|${a.mode}|${a.amount}`,
      text: (c) => `${c} is your SwiftPal code to withdraw ${money(a.amount)} to ${otp.maskPhone(withdrawTo)}. Don't share it.`,
    };
  }
  if (a.action === "payout") {
    return {
      purpose: "payout",
      payload: `payout|${a.mode}|${a.phone}|${a.amount}|${a.reference}|${a.reason}`,
      text: (c) => `${c} is your SwiftPal code to send ${money(a.amount)} to ${a.phone}. Don't share it.`,
    };
  }
  if (a.action === "refund") {
    return {
      purpose: "payout",
      payload: `refund|${a.mode}|${a.payment}|${a.amount}`,
      text: (c) => `${c} is your SwiftPal code to refund ${money(a.amount)} to your customer. Don't share it.`,
    };
  }
  const total = a.items.reduce((t, i) => t + i.amount, 0);
  return {
    purpose: "batch",
    payload: `batch|${a.mode}|${sha256(JSON.stringify(a.items.map((i) => [i.phone, i.amount, i.reference, i.reason])))}`,
    text: (c) => `${c} is your SwiftPal code to pay ${a.items.length} recipients ${money(total)} in total. Don't share it.`,
  };
}
