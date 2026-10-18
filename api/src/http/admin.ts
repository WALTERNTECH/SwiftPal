import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import { ApiError, safeEqual } from "../lib.js";
import * as admins from "../services/admins.js";
import type { Admin, Stage } from "../services/admins.js";
import * as ops from "../services/ops.js";
import * as verification from "../services/verification.js";
import { parse } from "./common.js";

declare module "fastify" {
  interface FastifyRequest {
    admin?: Admin | null;
    adminStage?: Stage;
    adminSession?: string;
  }
}

const COOKIE = "sp_admin";
const OPEN = new Set(["/admin/auth/state", "/admin/auth/setup", "/admin/auth/login"]);
// What a half-signed-in session may reach: finishing sign-in, and nothing else.
const STEP: Record<Exclude<Stage, "full">, string[]> = {
  enroll: ["/admin/me", "/admin/auth/enroll", "/admin/auth/logout"],
  totp: ["/admin/me", "/admin/auth/totp", "/admin/auth/logout"],
};

function cookieOf(req: FastifyRequest) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setCookie(app: App, reply: FastifyReply, value: string, maxAge: number) {
  const secure = app.cfg.env === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

const code6 = z.string().regex(/^\d{6}$/, "must be 6 digits");
const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

export function adminRoutes(api: FastifyInstance, app: App) {
  api.register(
    async (r) => {
      r.addHook("onRequest", async (req) => {
        const path = req.url.split("?")[0];
        // Scripts may use the server's admin token; it acts as the system, not as a person.
        const h = req.headers.authorization ?? "";
        if (h.startsWith("Bearer ")) {
          if (!app.cfg.adminToken || !safeEqual(h.slice(7), app.cfg.adminToken)) throw new ApiError(401, "unauthorized", "Admin token required.", "authentication_error");
          req.admin = null;
          req.adminStage = "full";
          return;
        }
        // Browser sessions only arrive through the console's own server, which adds this secret.
        if (app.cfg.adminGateway && !safeEqual(String(req.headers["x-admin-gateway"] ?? ""), app.cfg.adminGateway))
          throw new ApiError(404, "not_found", `No route for ${req.method} ${path}.`, "not_found");
        if (req.method !== "GET" && req.headers["x-requested-with"] !== "SwiftPal-Admin") throw new ApiError(403, "csrf", "Missing X-Requested-With header.", "permission_error");
        if (OPEN.has(path)) return;
        const s = await admins.sessionOf(app, cookieOf(req));
        if (!s) throw new ApiError(401, "not_signed_in", "Sign in to continue.", "authentication_error");
        req.admin = s.admin;
        req.adminStage = s.stage;
        req.adminSession = s.tokenHash;
        if (s.stage !== "full" && !STEP[s.stage].includes(path)) throw new ApiError(403, "second_step_required", "Finish signing in with your authenticator app.", "permission_error");
      });

      const person = (req: FastifyRequest) => {
        if (!req.admin) throw new ApiError(403, "person_required", "Sign in to the console for this.", "permission_error");
        return req.admin;
      };

      // ---------- sign-in ----------
      r.get("/auth/state", async () => ({ needs_setup: await admins.needsSetup(app) }));

      r.post("/auth/setup", async (req, reply) => {
        const b = parse(z.object({ setup_key: z.string().min(1).max(200), name: z.string().trim().min(2).max(80), email: z.email(), password: z.string().min(12).max(200) }), req.body);
        const out = await admins.setup(app, { setupKey: b.setup_key, name: b.name, email: b.email, password: b.password }, req.ip, req.headers["user-agent"]);
        setCookie(app, reply, out.session.token, out.session.maxAge);
        return { stage: out.stage };
      });

      r.post("/auth/login", async (req, reply) => {
        const b = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), req.body);
        const out = await admins.login(app, b.email, b.password, req.ip, req.headers["user-agent"]);
        setCookie(app, reply, out.session.token, out.session.maxAge);
        return { stage: out.stage };
      });

      r.get("/me", async (req) => ({ admin: req.admin, stage: req.adminStage }));

      r.get("/auth/enroll", async (req) => admins.startEnroll(app, person(req)));
      r.post("/auth/enroll", async (req, reply) => {
        const b = parse(z.object({ code: code6 }), req.body);
        const s = await admins.completeSignIn(app, person(req), "enroll", req.adminSession!, b.code, req.ip, req.headers["user-agent"]);
        setCookie(app, reply, s.token, s.maxAge);
        return { stage: "full" };
      });
      r.post("/auth/totp", async (req, reply) => {
        const b = parse(z.object({ code: code6 }), req.body);
        const s = await admins.completeSignIn(app, person(req), "totp", req.adminSession!, b.code, req.ip, req.headers["user-agent"]);
        setCookie(app, reply, s.token, s.maxAge);
        return { stage: "full" };
      });
      r.post("/auth/logout", async (req, reply) => {
        await admins.logout(app, cookieOf(req));
        setCookie(app, reply, "", 0);
        return { ok: true };
      });

      // ---------- overview ----------
      r.get("/overview", async () => ops.overview(app));
      r.get("/system", async () => ops.system(app));

      // ---------- verification ----------
      r.get("/verifications", async (req) => verification.listForReview(app, (req.query as { status?: string }).status ?? "submitted"));
      r.get("/verifications/:id", async (req) => {
        const v = await verification.reviewDetail(app, idParam(req));
        // Opening a KYC record shows the full ID number, so it goes on the record.
        await admins.audit(app.db, req.admin?.id ?? null, "kyc.viewed", { type: "merchant", id: String(v.merchant_id) }, { verification: v.id }, req.ip);
        return v;
      });
      r.get("/files/:id", async (req, reply) => {
        const f = await verification.reviewFile(app, idParam(req));
        return reply.header("Content-Type", f.contentType).header("Cache-Control", "private, no-store").header("Content-Disposition", `inline; filename="${f.filename.replace(/"/g, "")}"`).send(f.bytes);
      });
      r.post("/verifications/:id/approve", async (req) => ops.decideVerification(app, req.admin ?? null, idParam(req), true, undefined, req.ip));
      r.post("/verifications/:id/reject", async (req) => {
        const b = parse(z.object({ note: z.string().trim().min(5, "say what needs changing").max(500) }), req.body ?? {});
        return ops.decideVerification(app, req.admin ?? null, idParam(req), false, b.note, req.ip);
      });

      // ---------- merchants ----------
      r.get("/merchants", async (req) => {
        const q = req.query as { q?: string; status?: string };
        return ops.listMerchants(app, { q: q.q, status: q.status });
      });
      r.get("/merchants/:id", async (req) => ops.merchantDetail(app, idParam(req)));
      r.post("/merchants/:id/adjust", async (req) => {
        const b = parse(
          z.object({
            mode: z.enum(["live", "test"]).default("live"),
            account: z.enum(["fee", "float"]),
            direction: z.enum(["credit", "debit"]),
            amount: z.number().positive().max(1_000_000),
            reason: z.string().trim().min(5).max(300),
            reference: z.string().trim().max(60).optional(),
          }),
          req.body,
        );
        return ops.adjust(app, req.admin ?? null, idParam(req), b, req.ip);
      });
      r.post("/merchants/:id/suspend", async (req) => {
        const b = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
        await ops.setSuspended(app, req.admin ?? null, idParam(req), true, b.reason, req.ip);
        return { ok: true };
      });
      r.post("/merchants/:id/unsuspend", async (req) => {
        await ops.setSuspended(app, req.admin ?? null, idParam(req), false, undefined, req.ip);
        return { ok: true };
      });
      r.post("/keys/:id/revoke", async (req) => {
        await ops.revokeKey(app, req.admin ?? null, idParam(req), req.ip);
        return { ok: true };
      });

      // ---------- money ----------
      const resolution = z.object({ outcome: z.enum(["succeeded", "failed"]), receipt: z.string().trim().max(20).optional(), note: z.string().trim().min(5).max(300) });
      r.get("/payments", async (req) => {
        const q = req.query as { q?: string; status?: string; purpose?: string; stuck?: string; mode?: string };
        return ops.listPayments(app, { q: q.q, status: q.status, purpose: q.purpose, mode: q.mode, stuck: q.stuck === "1" });
      });
      r.post("/payments/:id/resolve", async (req) => ops.resolvePayment(app, req.admin ?? null, idParam(req), parse(resolution, req.body), req.ip));
      r.get("/payouts", async (req) => {
        const q = req.query as { q?: string; status?: string; stuck?: string; mode?: string };
        return ops.listPayouts(app, { q: q.q, status: q.status, mode: q.mode, stuck: q.stuck === "1" });
      });
      r.post("/payouts/:id/resolve", async (req) => ops.resolvePayout(app, req.admin ?? null, idParam(req), parse(resolution, req.body), req.ip));

      // ---------- audit and team ----------
      r.get("/audit", async (req) => {
        const q = req.query as { type?: string; id?: string };
        return ops.listAudit(app, { type: q.type, id: q.id, limit: 200 });
      });
      r.get("/admins", async () => admins.list(app));
      r.post("/admins", async (req, reply) => {
        const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: z.string().min(12).max(200), role: z.enum(["owner", "admin"]).default("admin") }), req.body);
        return reply.code(201).send(await admins.create(app, person(req), b, req.ip));
      });
      r.post("/admins/:id/disable", async (req) => {
        await admins.setDisabled(app, person(req), idParam(req), true, req.ip);
        return { ok: true };
      });
      r.post("/admins/:id/enable", async (req) => {
        await admins.setDisabled(app, person(req), idParam(req), false, req.ip);
        return { ok: true };
      });
      r.post("/admins/:id/reset-2fa", async (req) => {
        await admins.resetTwoFactor(app, person(req), idParam(req), req.ip);
        return { ok: true };
      });
    },
    { prefix: "/admin" },
  );
}
