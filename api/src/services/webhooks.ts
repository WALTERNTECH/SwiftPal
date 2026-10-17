import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { App, Mode } from "../app.js";
import { one } from "../db.js";
import { ApiError, hmacHex, newId, open, seal, token } from "../lib.js";
import { EVENT_TYPES } from "./events.js";

export type Endpoint = { id: string; merchant_id: string; mode: Mode; url: string; events: string[]; secret_enc: string; enabled: boolean; created_at: string };

/** Retry delays after each failed attempt, in seconds: 1m, 5m, 30m, 2h, 6h, 15h. */
export const RETRY_AFTER = [60, 300, 1800, 7200, 21600, 54000];

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

function privateAddress(ip: string) {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const m = ip.replace(/^::ffff:/, "").split(".").map(Number);
  if (m.length !== 4) return false;
  return m[0] === 10 || m[0] === 127 || m[0] === 0 || (m[0] === 169 && m[1] === 254) || (m[0] === 172 && m[1] >= 16 && m[1] <= 31) || (m[0] === 192 && m[1] === 168) || (m[0] === 100 && m[1] >= 64 && m[1] <= 127);
}

/** Refuses URLs that resolve to private networks, checked when added and again at every send. */
async function assertPublic(app: App, raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "invalid_url", "Enter a full URL starting with https://.");
  }
  if (app.cfg.allowPrivateWebhooks) return u;
  if (u.protocol !== "https:") throw new ApiError(400, "invalid_url", "Webhook endpoints must use HTTPS.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new ApiError(400, "invalid_url", `Could not resolve ${host}.`);
  if (addrs.some(privateAddress)) throw new ApiError(400, "invalid_url", "That URL points to a private network. Use a public address.");
  return u;
}

export async function addEndpoint(app: App, merchantId: string, mode: Mode, url: string, events: string[]) {
  const u = await assertPublic(app, url);
  const bad = events.filter((e) => !(EVENT_TYPES as readonly string[]).includes(e));
  if (!events.length || bad.length) throw new ApiError(400, "invalid_events", `Unknown events: ${bad.join(", ") || "none selected"}.`);
  const id = newId("we");
  const secret = `whsec_${token(24)}`;
  await app.db.query(`insert into webhook_endpoints (id, merchant_id, mode, url, events, secret_enc) values ($1,$2,$3,$4,$5,$6)`, [
    id,
    merchantId,
    mode,
    u.toString(),
    events,
    seal(app.cfg.masterKey, secret),
  ]);
  return { id, secret };
}

export async function listEndpoints(app: App, merchantId: string, mode: Mode) {
  const { rows } = await app.db.query<Endpoint>(`select * from webhook_endpoints where merchant_id = $1 and mode = $2 and removed_at is null order by created_at`, [merchantId, mode]);
  return rows.map((e) => ({ id: e.id, url: e.url, events: e.events, enabled: e.enabled, secret: open(app.cfg.masterKey, e.secret_enc), created_at: e.created_at }));
}

export async function updateEndpoint(app: App, merchantId: string, id: string, patch: { enabled?: boolean; events?: string[] }) {
  const { rows } = await app.db.query(
    `update webhook_endpoints set enabled = coalesce($3, enabled), events = coalesce($4, events) where id = $1 and merchant_id = $2 and removed_at is null returning id`,
    [id, merchantId, patch.enabled ?? null, patch.events ?? null],
  );
  if (!rows.length) throw new ApiError(404, "not_found", "No such endpoint.", "not_found");
}

export async function removeEndpoint(app: App, merchantId: string, id: string) {
  const { rows } = await app.db.query(`update webhook_endpoints set removed_at = now(), enabled = false where id = $1 and merchant_id = $2 and removed_at is null returning id`, [id, merchantId]);
  if (!rows.length) throw new ApiError(404, "not_found", "No such endpoint.", "not_found");
}

/** Sends a sample event to one endpoint now, without queueing. */
export async function sendTest(app: App, merchantId: string, id: string) {
  const ep = await one<Endpoint>(app.db, `select * from webhook_endpoints where id = $1 and merchant_id = $2 and removed_at is null`, [id, merchantId]);
  if (!ep) throw new ApiError(404, "not_found", "No such endpoint.", "not_found");
  const evt = { id: newId("evt"), type: "payment.succeeded", created_at: new Date().toISOString(), livemode: ep.mode === "live", test: true, data: { id: "pay_TEST", status: "succeeded", amount: 100 } };
  return post(app, ep, JSON.stringify(evt));
}

async function post(app: App, ep: Endpoint, body: string) {
  const started = Date.now();
  try {
    await assertPublic(app, ep.url);
    const res = await fetch(ep.url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", "User-Agent": "SwiftPal-Webhooks/1", "SwiftPal-Signature": sign(open(app.cfg.masterKey, ep.secret_enc), body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300, error: null as string | null, ms: Date.now() - started };
  } catch (e) {
    return { status: null, ok: false, error: (e as Error).message.slice(0, 300), ms: Date.now() - started };
  }
}

/** Worker step: claims due deliveries and sends them. */
export async function deliverDue(app: App, limit = 20) {
  const claimed = await app.db.tx(async (q) => {
    const { rows } = await q.query<{ id: string }>(
      `select id from webhook_deliveries where status = 'pending' and next_attempt_at <= now() order by next_attempt_at limit $1 for update skip locked`,
      [limit],
    );
    // Push the claim forward so a crash mid-send just retries later.
    if (rows.length) await q.query(`update webhook_deliveries set next_attempt_at = now() + interval '2 minutes' where id = any($1)`, [rows.map((r) => r.id)]);
    return rows.map((r) => r.id);
  });
  for (const id of claimed) {
    const d = await one<{ id: string; attempts: number; endpoint_id: string; event_id: string }>(app.db, `select * from webhook_deliveries where id = $1`, [id]);
    if (!d) continue;
    const ep = await one<Endpoint>(app.db, `select * from webhook_endpoints where id = $1`, [d.endpoint_id]);
    const ev = await one<{ id: string; type: string; mode: Mode; data: unknown; created_at: string }>(app.db, `select * from events where id = $1`, [d.event_id]);
    if (!ep || !ev || !ep.enabled) {
      await app.db.query(`update webhook_deliveries set status = 'failed', last_error = 'endpoint disabled' where id = $1`, [id]);
      continue;
    }
    const body = JSON.stringify({ id: ev.id, type: ev.type, created_at: ev.created_at, livemode: ev.mode === "live", data: ev.data });
    const r = await post(app, ep, body);
    const attempts = d.attempts + 1;
    const next = RETRY_AFTER[attempts - 1];
    await app.db.query(
      `update webhook_deliveries set attempts = $2, last_status = $3, last_error = $4, last_duration_ms = $5, last_attempt_at = now(),
       status = $6, next_attempt_at = now() + ($7 || ' seconds')::interval where id = $1`,
      [id, attempts, r.status, r.error, r.ms, r.ok ? "succeeded" : next === undefined ? "failed" : "pending", String(next ?? 0)],
    );
  }
  return claimed.length;
}

export async function replay(app: App, merchantId: string, deliveryId: string) {
  const { rows } = await app.db.query(
    `update webhook_deliveries d set status = 'pending', next_attempt_at = now()
     from webhook_endpoints e where d.id = $1 and e.id = d.endpoint_id and e.merchant_id = $2 returning d.id`,
    [deliveryId, merchantId],
  );
  if (!rows.length) throw new ApiError(404, "not_found", "No such delivery.", "not_found");
}

export async function listDeliveries(app: App, merchantId: string, mode: Mode, limit = 50) {
  const { rows } = await app.db.query(
    `select d.id, d.status, d.attempts, d.last_status, d.last_error, d.last_duration_ms, d.last_attempt_at, d.next_attempt_at, d.created_at,
            ev.id as event_id, ev.type, ev.data->>'id' as object_id, e.url
     from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id join events ev on ev.id = d.event_id
     where e.merchant_id = $1 and e.mode = $2 order by d.created_at desc limit $3`,
    [merchantId, mode, Math.min(limit, 200)],
  );
  return rows;
}
