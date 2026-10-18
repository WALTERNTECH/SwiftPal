import { ApiError } from "./lib.js";

// Fixed-window counters in memory. SwiftPal runs a single API instance; with
// more than one, these move to Postgres or Redis so every instance shares them.

type Window = { start: number; n: number; until: number };
const windows = new Map<string, Window>();

function bucket(key: string, windowMs: number, now: number) {
  const w = windows.get(key);
  if (w && now < w.until) return w;
  const fresh = { start: now, n: 0, until: now + windowMs };
  windows.set(key, fresh);
  return fresh;
}

export type Hit = { limit: number; remaining: number; resetMs: number };

/** Counts one request against `key` and refuses past `max` per window. */
export function limit(key: string, max: number, windowMs: number, message = "Too many requests. Try again in a little while.", now = Date.now()): Hit {
  const w = bucket(key, windowMs, now);
  w.n++;
  const hit = { limit: max, remaining: Math.max(0, max - w.n), resetMs: w.until - now };
  if (w.n > max) throw tooMany(message, hit.resetMs);
  return hit;
}

/** For attempts where only failures count: check before, `fail` after a wrong guess, `clear` on success. */
export function blocked(key: string, max: number, now = Date.now()) {
  const w = windows.get(key);
  return !!w && now < w.until && w.n >= max;
}
export function fail(key: string, windowMs: number, now = Date.now()) {
  bucket(key, windowMs, now).n++;
}
export const clear = (key: string) => windows.delete(key);
export const retryIn = (key: string, now = Date.now()) => Math.max(0, (windows.get(key)?.until ?? now) - now);

export function tooMany(message: string, resetMs: number) {
  return new ApiError(429, "rate_limited", message, "rate_limit_error", { retry_after: Math.max(1, Math.ceil(resetMs / 1000)) });
}

/** Tests start each case with empty counters. */
export const resetLimits = () => windows.clear();

// Expired windows are dropped so the map stays small.
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (now >= w.until) windows.delete(k);
}, 5 * 60_000).unref();
