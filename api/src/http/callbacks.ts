import type { FastifyInstance } from "fastify";
import type { App } from "../app.js";
import { ApiError, safeEqual } from "../lib.js";
import { parseB2cResult, parseB2cTimeout, parseStkCallback } from "../mpesa/callbacks.js";
import { handleStkResult } from "../services/payments.js";
import { handleB2cResult } from "../services/payouts.js";

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
