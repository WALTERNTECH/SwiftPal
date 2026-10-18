import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import { ApiError, kes, sha256 } from "../lib.js";
import * as accounts from "../services/accounts.js";
import type { User } from "../services/accounts.js";
import { analytics } from "../services/analytics.js";
import * as channels from "../services/channels.js";
import * as connect from "../services/connect.js";
import { createStk, createTopup, getPayment, listPayments, presentPayment } from "../services/payments.js";
import * as otp from "../services/otp.js";
import { createBatch, createPayout, listPayouts, presentPayout, REASONS } from "../services/payouts.js";
import * as sandbox from "../services/sandbox.js";
import * as verification from "../services/verification.js";
import * as webhooks from "../services/webhooks.js";
import { present, read } from "../services/wallet.js";
import { metadata, modeOf, parse, phone } from "./common.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

const COOKIE = "sp_session";

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

export function dashboardRoutes(api: FastifyInstance, app: App) {
  api.register(
    async (r) => {
      // ---------- auth (no session needed) ----------
      r.post("/auth/signup", async (req, reply) => {
        const b = parse(
          z.object({ first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), email: z.email(), phone: z.string(), password: z.string().min(10).max(200) }),
          req.body,
        );
        const { user, session } = await accounts.signUp(app, { firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone, password: b.password, ip: req.ip, ua: req.headers["user-agent"] });
        setCookie(app, reply, session, 30 * 86400);
        return reply.code(201).send({ user });
      });

      // Password first; with a verified phone that opens a pending session and texts a code.
      r.post("/auth/login", async (req, reply) => {
        const b = parse(z.object({ email: z.string(), password: z.string() }), req.body);
        const { user, session, otp: sent } = await accounts.signIn(app, { ...b, ip: req.ip, ua: req.headers["user-agent"] });
        setCookie(app, reply, session, sent ? 15 * 60 : 30 * 86400);
        return sent ? { otp_required: true, ...sent } : { otp_required: false, user };
      });

      r.post("/auth/login/verify", async (req, reply) => {
        const b = parse(z.object({ code: z.string().regex(/^\d{6}$/, "must be 6 digits") }), req.body);
        const { user, session } = await accounts.completeLogin(app, cookieOf(req), b.code, req.ip, req.headers["user-agent"]);
        setCookie(app, reply, session, 30 * 86400);
        return { user };
      });

      r.post("/auth/login/resend", async (req) => accounts.resendLoginCode(app, cookieOf(req)));

      r.post("/auth/forgot", async (req) => {
        const b = parse(z.object({ email: z.string().max(200) }), req.body);
        await accounts.requestReset(app, b.email);
        return { ok: true };
      });

      r.post("/auth/reset", async (req) => {
        const b = parse(z.object({ token: z.string().min(20).max(100), password: z.string().min(10).max(200) }), req.body);
        await accounts.resetPassword(app, b.token, b.password);
        return { ok: true };
      });

      r.post("/auth/logout", async (req, reply) => {
        await accounts.signOut(app, cookieOf(req));
        setCookie(app, reply, "", 0);
        return { ok: true };
      });

      // ---------- everything below needs a session ----------
      r.register(async (s) => {
        s.addHook("onRequest", async (req) => {
          // SameSite=Lax stops cross-site POSTs carrying the cookie; this header stops simple forms too.
          if (req.method !== "GET" && req.headers["x-requested-with"] !== "SwiftPal") throw new ApiError(403, "csrf", "Missing X-Requested-With header.", "permission_error");
          const user = await accounts.sessionUser(app, cookieOf(req));
          if (!user) throw new ApiError(401, "not_signed_in", "Sign in to continue.", "authentication_error");
          req.user = user;
          const path = req.url.split("?")[0];
          if (app.cfg.codes && !user.phone_verified_at && !["/app/auth/verify-phone", "/app/auth/resend-phone", "/app/me"].includes(path))
            throw new ApiError(403, "phone_unverified", "Verify your phone number first.", "permission_error");
          if (app.cfg.codes && user.phone_verified_at && !user.email_verified_at && !["/app/auth/verify-email", "/app/auth/resend", "/app/me"].includes(path))
            throw new ApiError(403, "email_unverified", "Verify your email first.", "permission_error");
        });
        const merchant = (req: FastifyRequest) => accounts.getMerchant(app.db, req.user!.merchant_id);

        s.post("/auth/verify-phone", async (req) => {
          const b = parse(z.object({ code: z.string().regex(/^\d{6}$/, "must be 6 digits") }), req.body);
          return { user: await accounts.verifyPhone(app, req.user!.id, b.code) };
        });
        s.post("/auth/resend-phone", async (req) => accounts.resendPhoneCode(app, req.user!.id));

        s.post("/auth/verify-email", async (req) => {
          const b = parse(z.object({ code: z.string().regex(/^\d{6}$/, "must be 6 digits") }), req.body);
          return { user: await accounts.verifyEmail(app, req.user!.id, b.code) };
        });
        s.post("/auth/resend", async (req) => {
          await accounts.resendCode(app, req.user!.id);
          return { ok: true };
        });

        s.get("/me", async (req) => {
          const m = await merchant(req);
          return {
            user: req.user,
            merchant: { ...m, low_balance_at: kes(m.low_balance_at_cents) },
            balances: { test: present(await read(app.db, m.id, "test")), live: present(await read(app.db, m.id, "live")) },
            channels: (await channels.listChannels(app, m.id)).map(channels.presentChannel),
            verification: await verification.current(app, m.id),
            live_available: !!app.mpesa.live,
            codes: app.cfg.codes,
            pending: Object.fromEntries(
              (
                await app.db.query<{ mode: string; n: number }>(
                  `select mode, count(*)::int as n from payments where merchant_id = $1 and purpose = 'charge' and status in ('pending','confirming') group by mode`,
                  [m.id],
                )
              ).rows.map((r) => [r.mode, Number(r.n)]),
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
          const code = z.string().regex(/^\d{6}$/, "must be 6 digits");
          const b = parse(z.object({ phone, current_code: code, new_code: code }), req.body);
          if (!app.cfg.codes) throw new ApiError(403, "phone_change_unavailable", "Contact support to change your number.", "permission_error");
          await accounts.confirmPhoneChange(app, req.user!, b.phone, b.current_code, b.new_code);
          return { ok: true };
        });

        // ---------- SMS confirmation for live money leaving the account ----------
        s.post("/confirmations", async (req) => {
          const a = parse(confirmable, req.body);
          if (a.mode === "test") return { required: false };
          await precheck(req, a);
          if (!app.cfg.codes) return { required: false };
          const { purpose, payload, text } = describe(a, req.user!.phone);
          return { required: true, ...(await otp.issue(app, { userId: req.user!.id, purpose, phone: req.user!.phone, payload, text })) };
        });
        /** Refuses before any SMS goes out when the money couldn't move anyway. */
        async function precheck(req: FastifyRequest, a: Confirmable) {
          if (!app.mpesa.live) throw new ApiError(503, "live_not_configured", "Live M-Pesa is not configured on this server yet.", "api_error");
          const m = await merchant(req);
          if (a.action !== "withdraw" && m.verification_status !== "approved")
            throw new ApiError(403, "payouts_not_enabled", "B2C needs a verified account. Complete Verification in the dashboard.", "permission_error");
          const need = a.action === "batch" ? a.items.reduce((t, i) => t + i.amount, 0) : a.amount;
          const float = (await read(app.db, m.id, "live")).float.available / 100;
          if (float < need) throw new ApiError(409, "insufficient_float", `Payout float is ${money(float)} and this needs ${money(need)}.`, "balance_error");
        }
        /** Uses the SMS code a live dashboard payout or withdrawal was confirmed with. */
        async function confirm(req: FastifyRequest, a: Confirmable, code: string | undefined) {
          if (a.mode === "test") return;
          await precheck(req, a);
          if (!app.cfg.codes) return;
          const d = describe(a, req.user!.phone);
          await otp.check(app, { userId: req.user!.id, purpose: d.purpose, code, payload: d.payload });
        }

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
            [req.user!.merchant_id, b.name ?? null, b.type ?? null, b.industry ?? null, b.monthly_volume ?? null, b.website ?? null, b.onboarding_done ?? null, b.auto_cover ?? null, b.low_balance_at === undefined ? null : Math.round(b.low_balance_at * 100)],
          );
          return { ok: true };
        });

        // ---------- channels ----------
        s.get("/channels", async (req) => (await channels.listChannels(app, req.user!.merchant_id)).map(channels.presentChannel));
        s.post("/channels", async (req, reply) => {
          const b = parse(
            z.object({
              kind: z.enum(["till", "paybill"]),
              shortcode: z.string(),
              account_number: z.string().optional(),
              display_name: z.string(),
              business_shortcode: z.string().optional(),
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
          return reply.code(201).send(channels.presentChannel(ch));
        });
        s.post("/channels/:id/default", async (req) => {
          await channels.setDefaultChannel(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });
        s.delete("/channels/:id", async (req) => {
          await channels.removeChannel(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });

        // ---------- connecting an assistant or CLI ----------
        s.get("/connect/:code", async (req) => connect.describe(app, (req.params as { code: string }).code));
        s.post("/connect/:code/approve", async (req) => {
          const b = parse(z.object({ scopes: z.array(z.string()).min(1).default(["payments:write", "payouts:write", "read"]) }), req.body ?? {});
          return connect.approve(app, req.user!.merchant_id, (req.params as { code: string }).code, b.scopes);
        });
        s.post("/connect/:code/deny", async (req) => {
          await connect.deny(app, (req.params as { code: string }).code);
          return { ok: true };
        });

        // ---------- keys ----------
        s.get("/keys", async (req) => accounts.listKeys(app, req.user!.merchant_id));
        s.post("/keys", async (req, reply) => {
          const b = parse(z.object({ name: z.string().max(60), mode: z.enum(["test", "live"]), scopes: z.array(z.string()).min(1) }), req.body);
          return reply.code(201).send(await accounts.createKey(app, await merchant(req), b.mode, b.name, b.scopes));
        });
        s.post("/keys/:id/roll", async (req) => accounts.rollKey(app, req.user!.merchant_id, (req.params as { id: string }).id));
        s.delete("/keys/:id", async (req) => {
          await accounts.revokeKey(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });

        // ---------- webhooks ----------
        s.get("/webhooks", async (req) => webhooks.listEndpoints(app, req.user!.merchant_id, modeOf(req)));
        s.post("/webhooks", async (req, reply) => {
          const b = parse(z.object({ url: z.string().max(500), events: z.array(z.string()).min(1), mode: z.enum(["test", "live"]) }), req.body);
          return reply.code(201).send(await webhooks.addEndpoint(app, req.user!.merchant_id, b.mode, b.url, b.events));
        });
        s.patch("/webhooks/:id", async (req) => {
          const b = parse(z.object({ enabled: z.boolean().optional(), events: z.array(z.string()).optional() }), req.body);
          await webhooks.updateEndpoint(app, req.user!.merchant_id, (req.params as { id: string }).id, b);
          return { ok: true };
        });
        s.delete("/webhooks/:id", async (req) => {
          await webhooks.removeEndpoint(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });
        s.post("/webhooks/:id/test", async (req) => webhooks.sendTest(app, req.user!.merchant_id, (req.params as { id: string }).id));
        s.get("/webhooks/deliveries", async (req) => webhooks.listDeliveries(app, req.user!.merchant_id, modeOf(req)));
        s.post("/webhooks/deliveries/:id/replay", async (req) => {
          await webhooks.replay(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });

        // ---------- payments and payouts ----------
        s.get("/payments", async (req) => {
          const q = req.query as { status?: string; q?: string; limit?: string; before?: string };
          return (await listPayments(app, req.user!.merchant_id, modeOf(req), { status: q.status, q: q.q, before: q.before, limit: Number(q.limit ?? 100) })).map(presentPayment);
        });
        s.get("/payments/counts", async (req) => {
          const { rows } = await app.db.query<{ status: string; n: number }>(
            `select status, count(*)::int as n from payments where merchant_id = $1 and mode = $2 and purpose = 'charge' group by status`,
            [req.user!.merchant_id, modeOf(req)],
          );
          const n = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
          return { all: n("pending", "confirming", "succeeded", "failed", "cancelled", "expired"), succeeded: n("succeeded"), pending: n("pending", "confirming"), unpaid: n("failed", "cancelled", "expired") };
        });
        s.get("/payments/:id", async (req) => {
          const p = await getPayment(app, req.user!.merchant_id, (req.params as { id: string }).id);
          if (!p) throw new ApiError(404, "not_found", "No such payment.", "not_found");
          return presentPayment(p);
        });
        s.post("/payments", async (req, reply) => {
          const b = parse(
            z.object({ mode: z.enum(["test", "live"]), phone, amount: z.number().int().min(1).max(250_000), reference: z.string().trim().min(1).max(12), channel: z.string().optional(), metadata }),
            req.body,
          );
          const { mode, ...input } = b;
          return reply.code(201).send(presentPayment(await createStk(app, await merchant(req), mode, input)));
        });
        s.get("/payouts", async (req) => {
          const q = req.query as { q?: string; limit?: string; before?: string };
          return (await listPayouts(app, req.user!.merchant_id, modeOf(req), { q: q.q, before: q.before, limit: Number(q.limit ?? 100) })).map(presentPayout);
        });
        s.get("/payouts/summary", async (req) => {
          const r = await app.db.query<{ sent: number; paid_out: string; failed: number }>(
            `select count(*) filter (where status = 'succeeded')::int as sent, coalesce(sum(amount) filter (where status = 'succeeded'), 0) as paid_out,
                    count(*) filter (where status in ('failed','reversed'))::int as failed
             from payouts where merchant_id = $1 and mode = $2 and purpose = 'payout'`,
            [req.user!.merchant_id, modeOf(req)],
          );
          const row = r.rows[0];
          return { sent: Number(row?.sent ?? 0), paid_out: Number(row?.paid_out ?? 0), failed: Number(row?.failed ?? 0) };
        });
        s.post("/payouts", async (req, reply) => {
          const b = parse(payoutAction.extend({ metadata, code: z.string().optional() }), req.body);
          const { mode, code, action: _a, ...input } = b;
          await confirm(req, b, code);
          return reply.code(201).send(presentPayout(await createPayout(app, await merchant(req), mode, input)));
        });
        s.post("/payouts/batches", async (req, reply) => {
          const b = parse(batchAction.extend({ reference: z.string().max(40).optional(), code: z.string().optional() }), req.body);
          await confirm(req, b, b.code);
          return reply.code(201).send(await createBatch(app, await merchant(req), b.mode, b.reference ?? null, b.items));
        });

        // ---------- wallet ----------
        s.get("/wallet", async (req) => {
          const m = await merchant(req);
          return { ...present(await read(app.db, m.id, modeOf(req))), auto_cover: m.auto_cover, low_balance_at: kes(m.low_balance_at_cents) };
        });
        s.get("/ledger", async (req) => {
          const q = req.query as { account?: string };
          const params: unknown[] = [req.user!.merchant_id, modeOf(req)];
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
        // Withdrawals only ever go to the account's verified number.
        s.post("/wallet/withdraw", async (req, reply) => {
          const b = parse(withdrawAction.extend({ code: z.string().optional() }), req.body);
          await confirm(req, b, b.code);
          const p = await createPayout(app, await merchant(req), b.mode, { phone: req.user!.phone, amount: b.amount, reference: "WITHDRAWAL", reason: "withdrawal" }, "withdrawal");
          return reply.code(201).send(presentPayout(p));
        });

        // ---------- insight ----------
        s.get("/analytics", async (req) => {
          const days = Number((req.query as { days?: string }).days ?? 30);
          return analytics(app, req.user!.merchant_id, modeOf(req), [7, 14, 30, 60, 90].includes(days) ? days : 30);
        });
        s.get("/logs", async (req) => {
          const { rows } = await app.db.query(
            `select id, method, path, status, duration_ms, request_body, response_body, created_at from request_logs where merchant_id = $1 and mode = $2 order by created_at desc limit 100`,
            [req.user!.merchant_id, modeOf(req)],
          );
          return rows;
        });

        // ---------- verification ----------
        s.get("/verification", async (req) => verification.current(app, req.user!.merchant_id));
        s.post("/verification", async (req, reply) => {
          const fields: Record<string, string> = {};
          const files: verification.Upload[] = [];
          for await (const part of req.parts()) {
            if (part.type === "file") {
              const bytes = await part.toBuffer();
              files.push({ docKey: part.fieldname, filename: part.filename, bytes });
            } else fields[part.fieldname] = String(part.value ?? "");
          }
          const kind = fields.kind === "business" ? "business" : "individual";
          const out = await verification.submit(app, await merchant(req), { kind, name: fields.name ?? "", idNumber: (fields.id_number ?? "").replace(/\D/g, ""), regNumber: fields.reg_number, kraPin: fields.kra_pin?.toUpperCase() }, files);
          return reply.code(201).send(out);
        });

        // ---------- sandbox helpers ----------
        s.post("/sandbox/seed", async (req) => {
          await sandbox.seed(app, req.user!.merchant_id);
          return { ok: true };
        });
        s.post("/sandbox/reset", async (req) => {
          await sandbox.reset(app, req.user!.merchant_id);
          return { ok: true };
        });
      });
    },
    { prefix: "/app" },
  );
}

// ---------- actions that need an SMS code in live mode ----------

const mode = z.enum(["test", "live"]);
const amount = z.number().int().min(10).max(250_000);
const withdrawAction = z.object({ action: z.literal("withdraw").default("withdraw"), mode, amount });
const payoutAction = z.object({ action: z.literal("payout").default("payout"), mode, phone, amount, reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS) });
const batchItem = z.object({ phone, amount, reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS) });
const batchAction = z.object({ action: z.literal("batch").default("batch"), mode, items: z.array(batchItem).min(1).max(1000) });
const confirmable = z.discriminatedUnion("action", [
  withdrawAction.extend({ action: z.literal("withdraw") }),
  payoutAction.extend({ action: z.literal("payout") }),
  batchAction.extend({ action: z.literal("batch") }),
]);
type Confirmable = z.infer<typeof withdrawAction> | z.infer<typeof payoutAction> | z.infer<typeof batchAction>;

const money = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/** The code's purpose, the exact request it is bound to, and the SMS that says what it approves. */
function describe(a: Confirmable, ownPhone: string): { purpose: otp.Purpose; payload: string; text: (c: string) => string } {
  if (a.action === "withdraw") {
    return {
      purpose: "withdraw",
      payload: `withdraw|${a.mode}|${a.amount}`,
      text: (c) => `${c} is your SwiftPal code to withdraw ${money(a.amount)} to ${otp.maskPhone(ownPhone)}. Don't share it.`,
    };
  }
  if (a.action === "payout") {
    return {
      purpose: "payout",
      payload: `payout|${a.mode}|${a.phone}|${a.amount}|${a.reference}|${a.reason}`,
      text: (c) => `${c} is your SwiftPal code to send ${money(a.amount)} to ${a.phone}. Don't share it.`,
    };
  }
  const total = a.items.reduce((s, i) => s + i.amount, 0);
  return {
    purpose: "batch",
    payload: `batch|${a.mode}|${sha256(JSON.stringify(a.items.map((i) => [i.phone, i.amount, i.reference, i.reason])))}`,
    text: (c) => `${c} is your SwiftPal code to pay ${a.items.length} recipients ${money(total)} in total. Don't share it.`,
  };
}
