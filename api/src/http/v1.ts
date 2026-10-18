import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { App, Mode } from "../app.js";
import { one } from "../db.js";
import { ApiError, sha256 } from "../lib.js";
import { authenticateKey, type ApiKeyRow, type Merchant } from "../services/accounts.js";
import { createStk, getPayment, listPayments, presentPayment } from "../services/payments.js";
import { createBatch, createPayout, listPayouts, presentPayout, REASONS, refundPayment, refundsOf, type Payout } from "../services/payouts.js";
import { present, read } from "../services/wallet.js";
import { metadata, pageSize, parse, phone } from "./common.js";

declare module "fastify" {
  interface FastifyRequest {
    key?: ApiKeyRow;
    merchant?: Merchant;
    mode?: Mode;
    idem?: { key: string; hash: string };
  }
}

const RATE = 300;
const windows = new Map<string, { start: number; n: number }>();

function rawKey(req: FastifyRequest) {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  // Basic with the key as username, for teams moving from APIs that use it.
  if (h.startsWith("Basic ")) return Buffer.from(h.slice(6), "base64").toString().split(":")[0];
  return "";
}

const stkBody = z.object({
  phone,
  amount: z.number().int("must be whole shillings").min(1).max(250_000),
  reference: z.string().trim().min(1).max(12, "at most 12 characters (M-Pesa's limit)"),
  description: z.string().trim().max(13, "at most 13 characters (M-Pesa's limit)").optional(),
  channel: z.string().max(40).optional(),
  metadata,
});

const payoutBody = z.object({
  phone,
  amount: z.number().int("must be whole shillings").min(10).max(250_000),
  reference: z.string().trim().min(1).max(32),
  reason: z.enum(REASONS),
  metadata,
});

export function v1Routes(api: FastifyInstance, app: App) {
  api.register(async (r) => {
    r.addHook("onRequest", async (req, reply) => {
      const found = await authenticateKey(app, rawKey(req));
      if (!found) throw new ApiError(401, "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer sp_test_… or sp_live_…", "authentication_error");
      if (found.key.ip_allowlist.length && !found.key.ip_allowlist.includes(req.clientIp))
        throw new ApiError(403, "ip_not_allowed", `This key only accepts requests from its IP allowlist (got ${req.clientIp}).`, "permission_error");
      if (found.merchant.suspended_at) throw new ApiError(403, "account_suspended", "This account is suspended. Contact SwiftPal support.", "permission_error");
      req.key = found.key;
      req.merchant = found.merchant;
      req.mode = found.key.mode;

      const now = Date.now();
      const w = windows.get(found.key.id);
      const cur = w && now - w.start < 60_000 ? w : { start: now, n: 0 };
      cur.n++;
      windows.set(found.key.id, cur);
      reply.header("X-RateLimit-Limit", RATE).header("X-RateLimit-Remaining", Math.max(0, RATE - cur.n)).header("X-RateLimit-Reset", Math.ceil((cur.start + 60_000) / 1000));
      if (cur.n > RATE) {
        reply.header("Retry-After", Math.ceil((cur.start + 60_000 - now) / 1000));
        throw new ApiError(429, "rate_limited", `More than ${RATE} requests a minute on this key.`, "rate_limit_error");
      }
    });

    // Idempotency: same key + same body → the stored response; same key + different body → 409.
    r.addHook("preHandler", async (req, reply) => {
      const k = req.headers["idempotency-key"];
      if (req.method !== "POST" || typeof k !== "string" || !k) return;
      if (k.length > 255) throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key is at most 255 characters.");
      const hash = sha256(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`);
      const prior = await one<{ request_hash: string; status: number | null; body: unknown }>(
        app.db,
        `select request_hash, status, body from idempotency_keys where merchant_id = $1 and mode = $2 and key = $3 and created_at > now() - interval '24 hours'`,
        [req.merchant!.id, req.mode, k],
      );
      if (prior) {
        if (prior.request_hash !== hash) throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
        if (prior.status === null) throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed.");
        reply.header("Idempotent-Replayed", "true");
        return reply.code(prior.status).send(prior.body);
      }
      await app.db.query(
        `insert into idempotency_keys (merchant_id, mode, key, request_hash) values ($1,$2,$3,$4)
         on conflict (merchant_id, mode, key) do update set request_hash = excluded.request_hash, status = null, body = null, created_at = now()`,
        [req.merchant!.id, req.mode, k, hash],
      );
      req.idem = { key: k, hash };
    });

    r.addHook("onSend", async (req, reply, payload) => {
      if (req.idem && req.merchant) {
        // Only definitive answers are stored; a 5xx can be retried with the same key.
        const status = reply.statusCode;
        if (status < 500) {
          await app.db.query(`update idempotency_keys set status = $4, body = $5 where merchant_id = $1 and mode = $2 and key = $3`, [req.merchant.id, req.mode, req.idem.key, status, payload as string]);
        } else {
          await app.db.query(`delete from idempotency_keys where merchant_id = $1 and mode = $2 and key = $3`, [req.merchant.id, req.mode, req.idem.key]);
        }
      }
      return payload;
    });

    // Request log, kept 30 days.
    r.addHook("onResponse", async (req, reply) => {
      if (!req.merchant) return;
      const resBody = (reply as unknown as { _logBody?: string })._logBody;
      app.db
        .query(`insert into request_logs (id, merchant_id, mode, key_id, method, path, status, duration_ms, ip, request_body, response_body) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          req.id,
          req.merchant.id,
          req.mode,
          req.key?.id ?? null,
          req.method,
          req.url.split("?")[0],
          reply.statusCode,
          Math.round(reply.elapsedTime),
          req.clientIp,
          req.body ? JSON.stringify(req.body).slice(0, 16_000) : null,
          resBody && resBody.length < 16_000 ? resBody : null,
        ])
        .catch((e) => app.log.warn("request log failed", e.message));
    });
    r.addHook("onSend", async (_req, reply, payload) => {
      if (typeof payload === "string") (reply as unknown as { _logBody?: string })._logBody = payload;
      return payload;
    });

    const need = (req: FastifyRequest, scope: string) => {
      if (!req.key!.scopes.includes(scope)) throw new ApiError(403, "key_scope_denied", `This key doesn't have the ${scope} scope.`, "permission_error");
    };

    r.post("/stk-push", async (req, reply) => {
      need(req, "payments:write");
      const body = parse(stkBody, req.body);
      const p = await createStk(app, req.merchant!, req.mode!, body);
      return reply.code(201).send(presentPayment(p));
    });

    r.get("/stk-push/:id", async (req) => {
      need(req, "read");
      const p = await getPayment(app, req.merchant!.id, (req.params as { id: string }).id);
      if (!p || p.mode !== req.mode || p.purpose !== "charge") throw new ApiError(404, "not_found", "No such payment.", "not_found");
      return presentPayment(p);
    });

    r.get("/payments", async (req) => {
      need(req, "read");
      const q = req.query as { status?: string; limit?: string; starting_after?: string };
      const size = pageSize(q.limit, 25, 100);
      const rows = await listPayments(app, req.merchant!.id, req.mode!, { status: q.status, limit: size, before: q.starting_after });
      return { object: "list", data: rows.map(presentPayment), has_more: rows.length === size };
    });

    // Refunds go back to the paying phone from the payout float; partial refunds add up to the payment at most.
    r.post("/payments/:id/refunds", async (req, reply) => {
      need(req, "payouts:write");
      const body = parse(z.object({ amount: z.number().int("must be whole shillings").min(10).max(250_000).optional() }), req.body ?? {});
      const p = await refundPayment(app, req.merchant!, req.mode!, (req.params as { id: string }).id, body.amount);
      return reply.code(201).send(presentPayout(p));
    });

    r.get("/payments/:id/refunds", async (req) => {
      need(req, "read");
      return { object: "list", data: await refundsOf(app, req.merchant!.id, (req.params as { id: string }).id) };
    });

    r.post("/payouts", async (req, reply) => {
      need(req, "payouts:write");
      const body = parse(payoutBody, req.body);
      return reply.code(201).send(presentPayout(await createPayout(app, req.merchant!, req.mode!, body)));
    });

    r.get("/payouts/:id", async (req) => {
      need(req, "read");
      const p = await one<Payout>(app.db, `select * from payouts where id = $1 and merchant_id = $2 and mode = $3 and purpose = 'payout'`, [
        (req.params as { id: string }).id,
        req.merchant!.id,
        req.mode,
      ]);
      if (!p) throw new ApiError(404, "not_found", "No such payout.", "not_found");
      return presentPayout(p);
    });

    r.post("/payouts/batches", async (req, reply) => {
      need(req, "payouts:write");
      const body = parse(z.object({ reference: z.string().max(40).optional(), items: z.array(payoutBody).min(1).max(1000) }), req.body);
      return reply.code(201).send(await createBatch(app, req.merchant!, req.mode!, body.reference ?? null, body.items));
    });

    r.get("/payouts/batches/:id", async (req) => {
      need(req, "read");
      const id = (req.params as { id: string }).id;
      const b = await one(app.db, `select * from payout_batches where id = $1 and merchant_id = $2 and mode = $3`, [id, req.merchant!.id, req.mode]);
      if (!b) throw new ApiError(404, "not_found", "No such batch.", "not_found");
      const items = await listPayouts(app, req.merchant!.id, req.mode!, { batch: id, limit: 200 });
      return { ...b, object: "payout_batch", items: items.map(presentPayout) };
    });

    r.get("/balance", async (req) => {
      need(req, "read");
      const m = req.merchant!;
      return { ...present(await read(app.db, m.id, req.mode!)), auto_cover: m.auto_cover, livemode: req.mode === "live" };
    });

    r.get("/events", async (req) => {
      need(req, "read");
      const q = req.query as { type?: string; limit?: string };
      const params: unknown[] = [req.merchant!.id, req.mode];
      let where = `merchant_id = $1 and mode = $2`;
      if (q.type) {
        params.push(q.type);
        where += ` and type = $3`;
      }
      params.push(pageSize(q.limit, 25, 100));
      const { rows } = await app.db.query(`select id, type, data, created_at from events where ${where} order by created_at desc limit $${params.length}`, params);
      return { object: "list", data: rows.map((e) => ({ ...e, livemode: req.mode === "live" })) };
    });
  }, { prefix: "/v1" });
}
