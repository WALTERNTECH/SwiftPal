import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import { limit, type Hit } from "../limits.js";
import * as links from "../services/links.js";
import { parse } from "./common.js";

/**
 * The public side of payment links, called by the pay page on the web app.
 * No session and no key: anyone with the link may pay, so per-address and
 * per-phone limits stand in for authentication.
 */
export function payRoutes(api: FastifyInstance, app: App) {
  const headers = (reply: FastifyReply, h: Hit) => reply.header("X-RateLimit-Limit", h.limit).header("X-RateLimit-Remaining", h.remaining);
  const slugOf = (p: unknown) => String((p as { slug: string }).slug ?? "").toLowerCase();

  api.get("/pay/links/:slug", async (req, reply) => {
    headers(reply, limit(`link-view:${req.clientIp}`, 120, 60_000));
    return links.publicView(app, slugOf(req.params));
  });

  api.post("/pay/links/:slug", async (req, reply) => {
    const b = parse(z.object({ phone: z.string().max(20), amount: z.number().int("must be whole shillings").min(1).max(250_000).optional() }), req.body);
    return reply.code(201).send(await links.pay(app, slugOf(req.params), b, req.clientIp));
  });

  api.get("/pay/status/:id", async (req, reply) => {
    headers(reply, limit(`link-status:${req.clientIp}`, 240, 60_000));
    return links.publicStatus(app, String((req.params as { id: string }).id).slice(0, 64));
  });
}
