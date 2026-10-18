import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { App } from "../app.js";
import * as connect from "../services/connect.js";
import { parse } from "./common.js";

/** Public half of the connect flow, called by the assistant or CLI. No key or session. */
export function connectRoutes(api: FastifyInstance, app: App) {
  api.post("/connect/start", async (req, reply) => {
    const b = parse(z.object({ client_name: z.string().max(80).optional() }), req.body ?? {});
    return reply.code(201).send(await connect.start(app, b.client_name, req.ip));
  });

  api.post("/connect/token", async (req, reply) => {
    const b = parse(z.object({ device_code: z.string().min(20).max(100) }), req.body);
    const r = await connect.collect(app, b.device_code);
    return reply.code(r.status === "pending" ? 202 : 200).send(r);
  });
}
