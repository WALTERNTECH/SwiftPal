import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Mode } from "../app.js";
import { ApiError, normalisePhone } from "../lib.js";

export const DOCS = "https://swiftpal-web.onrender.com/docs/errors";

export function errorBody(e: ApiError) {
  return {
    error: {
      type: e.type,
      code: e.code,
      message: e.message,
      doc_url: `${DOCS}#${e.code}`,
      ...(e.details ? { details: e.details } : {}),
    },
  };
}

/** Parses with zod and turns the first problem into a plain-English 400. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue.path.join(".") || "body";
  throw new ApiError(400, issue.code === "invalid_type" && issue.input === undefined ? "missing_field" : `invalid_${String(issue.path[0] ?? "request")}`, `${field}: ${issue.message}`);
}

export const phone = z.string().transform((v, ctx) => {
  const p = normalisePhone(v);
  if (!p) {
    ctx.addIssue({ code: "custom", message: "not a Safaricom number. Send 07XXXXXXXX, 01XXXXXXXX or 2547XXXXXXXX." });
    return z.NEVER;
  }
  return p;
});

export const metadata = z
  .record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((m) => Object.keys(m).length <= 20, "at most 20 keys")
  .optional();

export const modeOf = (req: FastifyRequest): Mode => {
  const m = (req.query as { mode?: string })?.mode ?? (req.body as { mode?: string } | undefined)?.mode;
  return m === "live" ? "live" : "test";
};

export const send = (reply: FastifyReply, status: number, body: unknown) => reply.code(status).send(body);
