import type { FastifyInstance } from "fastify";
import type { App } from "../app.js";
import { ApiError, safeEqual } from "../lib.js";
import { parseB2cResult, parseB2cTimeout, parseStkCallback } from "../mpesa/callbacks.js";
import { handleStkResult } from "../services/payments.js";
import { handleB2cResult } from "../services/payouts.js";
import * as verification from "../services/verification.js";

/**
 * Safaricom posts results here. It signs nothing, so the secret token in the
 * path is the only gate, every success is re-read before it is trusted, and
 * the raw body is stored before anything else happens.
 */
export function callbackRoutes(api: FastifyInstance, app: App) {
  const ACK = { ResultCode: 0, ResultDesc: "Accepted" };
  const gate = (token: string) => {
    if (!app.cfg.callbackToken || !safeEqual(token, app.cfg.callbackToken)) throw new ApiError(404, "not_found", "Not found.", "not_found");
  };

  api.post("/callbacks/daraja/stk/:token", async (req) => {
    gate((req.params as { token: string }).token);
    const r = parseStkCallback(req.body);
    if (!r) {
      await app.db.query(`insert into daraja_callbacks (kind, payload, outcome) values ('stk', $1, 'unparsed')`, [JSON.stringify(req.body ?? null)]);
      return ACK;
    }
    try {
      await handleStkResult(app, r);
    } catch (e) {
      app.log.error("stk callback failed", r.checkoutRequestId, (e as Error).message);
    }
    return ACK;
  });

  for (const kind of ["result", "timeout"] as const) {
    api.post(`/callbacks/daraja/b2c-${kind}/:token`, async (req) => {
      gate((req.params as { token: string }).token);
      const r = kind === "result" ? parseB2cResult(req.body) : parseB2cTimeout(req.body);
      if (!r) {
        await app.db.query(`insert into daraja_callbacks (kind, payload, outcome) values ($1, $2, 'unparsed')`, [`b2c_${kind}`, JSON.stringify(req.body ?? null)]);
        return ACK;
      }
      try {
        await handleB2cResult(app, r, kind);
      } catch (e) {
        app.log.error("b2c callback failed", r.originatorConversationId, (e as Error).message);
      }
      return ACK;
    });
  }
}

/** Review endpoints for the admin console, behind ADMIN_TOKEN until that console exists. */
export function adminRoutes(api: FastifyInstance, app: App) {
  api.register(
    async (r) => {
      r.addHook("onRequest", async (req) => {
        const h = req.headers.authorization ?? "";
        if (!app.cfg.adminToken || !h.startsWith("Bearer ") || !safeEqual(h.slice(7), app.cfg.adminToken))
          throw new ApiError(401, "unauthorized", "Admin token required.", "authentication_error");
      });
      r.get("/verifications", async (req) => verification.listForReview(app, (req.query as { status?: string }).status ?? "submitted"));
      r.get("/verifications/:id", async (req) => verification.reviewDetail(app, (req.params as { id: string }).id));
      r.get("/files/:id", async (req, reply) => {
        const f = await verification.reviewFile(app, (req.params as { id: string }).id);
        return reply.header("Content-Type", f.contentType).header("Cache-Control", "private, no-store").header("Content-Disposition", `inline; filename="${f.filename.replace(/"/g, "")}"`).send(f.bytes);
      });
      r.post("/verifications/:id/approve", async (req) => verification.decide(app, (req.params as { id: string }).id, true));
      r.post("/verifications/:id/reject", async (req) => verification.decide(app, (req.params as { id: string }).id, false, (req.body as { note?: string } | undefined)?.note));
      r.get("/merchants", async () => {
        const { rows } = await app.db.query(
          `select m.id, m.name, m.type, m.verification_status, m.live_enabled, m.created_at, u.email,
             (select available_cents from balances b where b.merchant_id = m.id and b.mode = 'live' and b.account = 'fee') as live_fee_cents,
             (select available_cents from balances b where b.merchant_id = m.id and b.mode = 'live' and b.account = 'float') as live_float_cents
           from merchants m join users u on u.merchant_id = m.id and u.role = 'owner' order by m.created_at desc limit 200`,
        );
        return rows;
      });
    },
    { prefix: "/admin" },
  );
}
