import type { FastifyInstance } from "fastify";
import type { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { pgliteDb } from "../src/db.js";
import { createApp } from "../src/index.js";
import { migrate } from "../src/migrate.js";
import { buildServer } from "../src/server.js";

export type Ctx = { app: App; api: FastifyInstance; mails: { to: string; subject: string; text: string }[]; sms: { to: string; text: string }[] };

export async function boot(env: Record<string, string> = {}): Promise<Ctx> {
  const mails: Ctx["mails"] = [];
  const sms: Ctx["sms"] = [];
  const cfg = loadConfig({ NODE_ENV: "test", VERIFICATION_CODES: "on", SANDBOX_DELAY_MS: "40", ALLOW_PRIVATE_WEBHOOKS: "true", ADMIN_TOKEN: "admin-token-for-tests", ...env });
  const app = await createApp({
    cfg,
    db: await pgliteDb(),
    log: { info: () => {}, warn: () => {}, error: (...a: unknown[]) => console.error(...a) },
    mail: { send: async (to, subject, text) => void mails.push({ to, subject, text }) },
    sms: { send: async (to, text) => void sms.push({ to, text }) },
  });
  await migrate(app.db);
  const api = await buildServer(app);
  return { app, api, mails, sms };
}

export async function stop(c: Ctx) {
  (c.app.mpesa.test as unknown as { stop?: () => void }).stop?.();
  await c.api.close();
  await c.app.db.close();
}

/** The latest 6-digit code texted to a number. */
export const smsCode = (c: Ctx, phone: string) => c.sms.filter((m) => m.to === phone).at(-1)!.text.match(/\b(\d{6})\b/)![1];
export const mailCode = (c: Ctx, email: string) => c.mails.filter((m) => m.to === email).at(-1)!.text.match(/\b(\d{6})\b/)![1];

/** A signed-in dashboard session (phone and email verified) plus a test API key. */
export async function merchant(c: Ctx, email = `dev${Math.random().toString(36).slice(2, 8)}@example.co.ke`, phone = `2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`) {
  const res = await c.api.inject({
    method: "POST",
    url: "/app/auth/signup",
    payload: { first_name: "Amina", last_name: "Otieno", email, phone, password: "correct-horse-battery" },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed ${res.statusCode} ${res.body}`);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  const dash = (method: string, url: string, payload?: unknown) =>
    c.api.inject({ method: method as never, url, payload: payload as never, headers: { cookie, "x-requested-with": "SwiftPal" } });
  const p = await dash("POST", "/app/auth/verify-phone", { code: smsCode(c, phone) });
  if (p.statusCode !== 200) throw new Error(`verify phone failed ${p.body}`);
  const v = await dash("POST", "/app/auth/verify-email", { code: mailCode(c, email) });
  if (v.statusCode !== 200) throw new Error(`verify email failed ${v.body}`);
  // The dashboard has no sandbox; the suite still drives the API through a test key.
  const key = ((await dash("POST", "/app/keys", { name: "suite", mode: "test", scopes: ["payments:write", "payouts:write", "read"] })).json() as { secret: string }).secret;
  const api = (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    c.api.inject({ method: method as never, url, payload: payload as never, headers: { authorization: `Bearer ${key}`, ...headers } });
  const me = (await dash("GET", "/app/me")).json() as { merchant: { id: string } };
  return { email, phone, cookie, key, dash, api, merchantId: me.merchant.id };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** multipart/form-data body for inject. */
export function form(fields: Record<string, string>, files: Record<string, { name: string; type: string; bytes: Buffer }>) {
  const boundary = "----swiftpaltest" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, f] of Object.entries(files)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.bytes, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
