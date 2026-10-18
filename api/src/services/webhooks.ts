import { lookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
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

// Addresses a webhook may never reach: private, loopback, link-local (cloud
// metadata lives at 169.254.169.254), carrier NAT, reserved and multicast.
// Two lists, because a BlockList also matches IPv4 against IPv4-mapped IPv6 rules.
const PRIVATE_V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE_V4.addSubnet(net, bits, "ipv4");
const PRIVATE_V6 = new BlockList();
for (const [net, bits] of [
  ["::", 96], ["::1", 128], ["::ffff:0:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) PRIVATE_V6.addSubnet(net, bits, "ipv6");

/** IPv4 written inside IPv6 (::ffff:7f00:1, ::ffff:127.0.0.1) is judged as the IPv4 it is. */
function embeddedV4(ip: string) {
  const m = /^::ffff:(?:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16);
  const lo = parseInt(m[3], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function privateAddress(ip: string) {
  const v4 = embeddedV4(ip);
  if (v4) return isIP(v4) !== 4 || PRIVATE_V4.check(v4, "ipv4");
  const family = isIP(ip);
  if (!family) return true;
  return family === 4 ? PRIVATE_V4.check(ip, "ipv4") : PRIVATE_V6.check(ip, "ipv6");
}

/** Refuses URLs that are malformed, not HTTPS, or name a private address outright. */
async function assertPublic(app: App, raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "invalid_url", "Enter a full URL starting with https://.");
  }
  if (u.username || u.password) throw new ApiError(400, "invalid_url", "Leave credentials out of the URL; check the SwiftPal-Signature header instead.");
  if (app.cfg.allowPrivateWebhooks) return u;
  if (u.protocol !== "https:") throw new ApiError(400, "invalid_url", "Webhook endpoints must use HTTPS.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (privateAddress(host)) throw new ApiError(400, "invalid_url", "That URL points to a private network. Use a public address.");
    return u;
  }
  const addrs = await new Promise<LookupAddress[]>((resolve) => lookup(host, { all: true }, (err, a) => resolve(err ? [] : a)));
  if (!addrs.length) throw new ApiError(400, "invalid_url", `Could not resolve ${host}.`);
  if (addrs.some((a) => privateAddress(a.address))) throw new ApiError(400, "invalid_url", "That URL points to a private network. Use a public address.");
  return u;
}

/**
 * DNS is checked again at the moment of connecting, on the exact address the
 * socket uses, so a name that resolves to a public address when saved and a
 * private one later (DNS rebinding) is still refused.
 */
function guardedLookup(allowPrivate: boolean) {
  return ((hostname: string, options: { all?: boolean; family?: number }, cb: (...a: unknown[]) => void) => {
    lookup(hostname, { family: options.family ?? 0, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const bad = allowPrivate ? undefined : addrs.find((a) => privateAddress(a.address));
      if (bad || !addrs.length) return cb(Object.assign(new Error(`refused to connect to a private address (${bad?.address ?? "none"})`), { code: "EPRIVATE" }));
      if (options.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  }) as unknown as typeof lookup;
}

/** POSTs without following redirects; resolves with the status code. */
function deliver(u: URL, body: string, headers: Record<string, string>, allowPrivate: boolean, timeoutMs = 10_000) {
  return new Promise<number>((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      { method: "POST", headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) }, lookup: guardedLookup(allowPrivate), timeout: timeoutMs },
      (res) => {
        res.resume(); // the body is never read, only drained
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer within ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    req.end(body);
  });
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
    const u = await assertPublic(app, ep.url);
    const status = await deliver(
      u,
      body,
      { "Content-Type": "application/json", "User-Agent": "SwiftPal-Webhooks/1", "SwiftPal-Signature": sign(open(app.cfg.masterKey, ep.secret_enc), body) },
      app.cfg.allowPrivateWebhooks,
    );
    return { status, ok: status >= 200 && status < 300, error: null as string | null, ms: Date.now() - started };
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
