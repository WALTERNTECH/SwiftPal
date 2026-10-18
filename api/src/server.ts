import multipart from "@fastify/multipart";
import Fastify, { type FastifyRequest } from "fastify";
import { isIP } from "node:net";
import type { App } from "./app.js";
import { adminRoutes } from "./http/admin.js";
import { callbackRoutes } from "./http/callbacks.js";
import { errorBody } from "./http/common.js";
import { connectRoutes } from "./http/connect.js";
import { dashboardRoutes } from "./http/dashboard.js";
import { payRoutes } from "./http/pay.js";
import { v1Routes } from "./http/v1.js";
import { ApiError, newId, safeEqual } from "./lib.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The visitor's address: from the web or console server when it vouches for it, else the TCP peer behind Render's proxies. */
    clientIp: string;
  }
}

/**
 * The dashboard and console reach the API through their own servers, so the
 * peer address is theirs. They pass the visitor's address with a shared
 * secret; without the secret the header is ignored.
 */
function clientIp(app: App, req: FastifyRequest) {
  const proof = String(req.headers["x-swiftpal-proxy"] ?? "");
  const vouched = proof && [app.cfg.proxySecret, app.cfg.adminGateway].some((s) => !!s && safeEqual(proof, s));
  const claimed = String(req.headers["x-swiftpal-client-ip"] ?? "").trim();
  return vouched && isIP(claimed) ? claimed : req.ip;
}

export async function buildServer(app: App) {
  const api = Fastify({
    logger: app.cfg.env === "test" ? false : { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
    // Render puts Cloudflare and its own proxy in front: client, CF, Render internal.
    trustProxy: (_addr: string, hop: number) => hop < 3,
    bodyLimit: 1_048_576,
    genReqId: () => newId("req"),
    requestIdHeader: false,
  });

  await api.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 6, fields: 20 } });

  api.decorateRequest("clientIp", "");
  api.addHook("onRequest", async (req) => {
    req.clientIp = clientIp(app, req);
  });

  api.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Request-Id", req.id);
    // Nothing the API serves is meant to render as a page or sit in a frame.
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (!req.url.startsWith("/admin/files/")) reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (app.cfg.env === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Account data and one-time secrets must not sit in a shared or browser cache.
    if (!reply.hasHeader("Cache-Control") && /^\/(app|admin|connect|pay|v1)\b/.test(req.url)) reply.header("Cache-Control", "no-store");
    return payload;
  });

  api.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      const wait = err.status === 429 ? Number(err.details?.retry_after) : NaN;
      if (Number.isFinite(wait)) reply.header("Retry-After", wait);
      return reply.code(err.status).send(errorBody(err));
    }
    const e = err as { statusCode?: number; code?: string; message: string; validation?: unknown };
    if (e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || e.code === "FST_ERR_CTP_EMPTY_JSON_BODY" || e.statusCode === 400)
      return reply.code(400).send(errorBody(new ApiError(400, "invalid_json", "Send a JSON body with Content-Type: application/json.")));
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.statusCode === 413) return reply.code(413).send(errorBody(new ApiError(413, "file_too_large", "Files are limited to 10 MB.")));
    req.log.error(err);
    return reply.code(500).send(errorBody(new ApiError(500, "internal_error", `Something went wrong on our side. Quote ${req.id} to support.`, "api_error")));
  });

  api.setNotFoundHandler((req, reply) => reply.code(404).send(errorBody(new ApiError(404, "not_found", `No route for ${req.method} ${req.url.split("?")[0]}.`, "not_found"))));

  api.get("/health", async () => ({ ok: true, live: !!app.mpesa.live }));
  v1Routes(api, app);
  connectRoutes(api, app);
  payRoutes(api, app);
  dashboardRoutes(api, app);
  callbackRoutes(api, app);
  adminRoutes(api, app);
  return api;
}
