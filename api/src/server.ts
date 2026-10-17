import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { App } from "./app.js";
import { adminRoutes, callbackRoutes } from "./http/callbacks.js";
import { errorBody } from "./http/common.js";
import { dashboardRoutes } from "./http/dashboard.js";
import { v1Routes } from "./http/v1.js";
import { ApiError, newId } from "./lib.js";

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

  api.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Request-Id", req.id);
    return payload;
  });

  api.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send(errorBody(err));
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
  dashboardRoutes(api, app);
  callbackRoutes(api, app);
  adminRoutes(api, app);
  return api;
}
