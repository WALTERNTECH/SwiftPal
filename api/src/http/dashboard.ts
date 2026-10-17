import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import { ApiError, kes } from "../lib.js";
import * as accounts from "../services/accounts.js";
import type { User } from "../services/accounts.js";
import { analytics } from "../services/analytics.js";
import * as channels from "../services/channels.js";
import { createStk, createTopup, getPayment, listPayments, presentPayment } from "../services/payments.js";
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

      r.post("/auth/login", async (req, reply) => {
        const b = parse(z.object({ email: z.string(), password: z.string() }), req.body);
        const { user, session } = await accounts.signIn(app, { ...b, ip: req.ip, ua: req.headers["user-agent"] });
        setCookie(app, reply, session, 30 * 86400);
        return { user };
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
          const allowedUnverified = ["/app/auth/verify-email", "/app/auth/resend", "/app/me"].includes(path);
          if (!allowedUnverified && !user.email_verified_at) throw new ApiError(403, "email_unverified", "Verify your email first.", "permission_error");
        });
        const merchant = (req: FastifyRequest) => accounts.getMerchant(app.db, req.user!.merchant_id);

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
          };
        });

        s.patch("/me", async (req) => {
          const b = parse(z.object({ first_name: z.string().trim().min(1).max(60).optional(), last_name: z.string().trim().min(1).max(60).optional(), phone: phone.optional() }), req.body);
          await app.db.query(`update users set first_name = coalesce($2, first_name), last_name = coalesce($3, last_name), phone = coalesce($4, phone) where id = $1`, [
            req.user!.id,
            b.first_name ?? null,
            b.last_name ?? null,
            b.phone ?? null,
          ]);
          return { ok: true };
        });

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
        s.post("/channels/:id/verify", async (req) => {
          const out = await channels.startVerification(app, await merchant(req), req.user!, (req.params as { id: string }).id);
          return { channel: channels.presentChannel(out.channel), payment: out.payment && presentPayment(out.payment) };
        });
        s.post("/channels/:id/confirm", async (req) => {
          const out = await channels.confirmVerification(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { channel: channels.presentChannel(out.channel), live_key: out.liveKey };
        });
        s.post("/channels/:id/default", async (req) => {
          await channels.setDefaultChannel(app, req.user!.merchant_id, (req.params as { id: string }).id);
          return { ok: true };
        });
        s.delete("/channels/:id", async (req) => {
          await channels.removeChannel(app, req.user!.merchant_id, (req.params as { id: string }).id);
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
          const q = req.query as { status?: string; q?: string; limit?: string };
          return (await listPayments(app, req.user!.merchant_id, modeOf(req), { status: q.status, q: q.q, limit: Number(q.limit ?? 100) })).map(presentPayment);
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
          const q = req.query as { q?: string; limit?: string };
          return (await listPayouts(app, req.user!.merchant_id, modeOf(req), { q: q.q, limit: Number(q.limit ?? 100) })).map(presentPayout);
        });
        s.post("/payouts", async (req, reply) => {
          const b = parse(
            z.object({ mode: z.enum(["test", "live"]), phone, amount: z.number().int().min(10).max(250_000), reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS), metadata }),
            req.body,
          );
          const { mode, ...input } = b;
          return reply.code(201).send(presentPayout(await createPayout(app, await merchant(req), mode, input)));
        });
        s.post("/payouts/batches", async (req, reply) => {
          const item = z.object({ phone, amount: z.number().int().min(10).max(250_000), reference: z.string().trim().min(1).max(32), reason: z.enum(REASONS) });
          const b = parse(z.object({ mode: z.enum(["test", "live"]), reference: z.string().max(40).optional(), items: z.array(item).min(1).max(1000) }), req.body);
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
        s.post("/wallet/withdraw", async (req, reply) => {
          const b = parse(z.object({ mode: z.enum(["test", "live"]), amount: z.number().int().min(10).max(250_000) }), req.body);
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
