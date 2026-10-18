"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// The console's data layer. Every call goes to /backend/admin/* on this
// server, which forwards it to the API with the gateway secret.

export type PayStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";
export type PayoutStatus = "processing" | "succeeded" | "failed" | "reversed";
export type Stage = "enroll" | "totp" | "full";
export type Admin = { id: string; email: string; name: string; role: "owner" | "admin"; totp_enabled_at: string | null; disabled_at: string | null; last_login_at: string | null; created_at: string };
export type Bal = { available: number; held: number };
export type Balances = { fee_credit: Bal; payout_float: Bal; currency: "KES" };
export type Payment = {
  id: string;
  status: PayStatus;
  amount: number;
  phone: string;
  reference: string;
  mpesa_receipt: string | null;
  failure_message: string | null;
  fee: { amount: number; charged: boolean };
  purpose: "charge" | "topup" | "channel_verify";
  merchant_id?: string;
  merchant_name?: string;
  raw_status?: string;
  created_at: string;
  completed_at: string | null;
};
export type Payout = {
  id: string;
  status: PayoutStatus;
  amount: number;
  phone: string;
  recipient_name: string | null;
  reference: string;
  reason: string;
  batch: string | null;
  mpesa_receipt: string | null;
  failure_message: string | null;
  fee: { amount: number; refunded: boolean };
  purpose: "payout" | "withdrawal";
  merchant_id?: string;
  merchant_name?: string;
  raw_status?: string;
  created_at: string;
};
export type AuditRow = { id: number; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; ip: string | null; created_at: string; admin_name: string | null; admin_email: string | null };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// The API sleeps on Render's free plan and only a request from outside Render
// wakes it, so the browser pings it directly, then waits for it through this server.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
let waking: Promise<void> | null = null;
let wakingNow = false;
const wakeSubs = new Set<() => void>();
const setWaking = (v: boolean) => {
  wakingNow = v;
  wakeSubs.forEach((f) => f());
};

export function wakeApi(): Promise<void> {
  waking ??= (async () => {
    const healthy = async () => {
      try {
        return (await fetch("/backend/health", { cache: "no-store" })).ok;
      } catch {
        return false;
      }
    };
    if (await healthy()) return;
    setWaking(true);
    const ping = () => (API_ORIGIN ? fetch(`${API_ORIGIN}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {}) : Promise.resolve());
    ping();
    let pinged = Date.now();
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2500));
      if (await healthy()) return;
      if (Date.now() - pinged > 20_000) {
        ping();
        pinged = Date.now();
      }
    }
    throw new ApiError(503, "unavailable", "The API isn't responding. Try again in a minute.");
  })().finally(() => {
    setWaking(false);
    setTimeout(() => (waking = null), 0);
  });
  return waking;
}

export function useWaking() {
  return useSyncExternalStore(
    (f) => {
      wakeSubs.add(f);
      return () => wakeSubs.delete(f);
    },
    () => wakingNow,
    () => false,
  );
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}, attempt = 0): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  let res: Response;
  try {
    res = await fetch(`/backend/admin${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "SwiftPal-Admin", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string } } | null)?.error;
    if (!e && [502, 503, 504].includes(res.status) && attempt < 1) {
      await wakeApi();
      return api<T>(path, opts, attempt + 1);
    }
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status}).`);
  }
  return json as T;
}

// ---------- cache ----------
type Entry = { data?: unknown; error?: ApiError; at: number; inflight?: Promise<unknown> };
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function load(key: string) {
  const e = cache.get(key) ?? { at: 0 };
  if (e.inflight) return e.inflight;
  e.inflight = api(key)
    .then((data) => void cache.set(key, { data, at: Date.now() }))
    .catch((error: ApiError) => void cache.set(key, { data: e.data, error, at: Date.now() }))
    .finally(() => subs.get(key)?.forEach((f) => f()));
  cache.set(key, e);
  return e.inflight;
}

export function invalidate(...prefixes: string[]) {
  return Promise.all([...cache.keys()].filter((k) => prefixes.some((p) => k.startsWith(p))).map(load));
}

export function clearCache() {
  cache.clear();
}

export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!path) return;
    const f = () => force((n) => n + 1);
    if (!subs.has(path)) subs.set(path, new Set());
    subs.get(path)!.add(f);
    const e = cache.get(path);
    if (!e || Date.now() - e.at > 4000) load(path);
    const t = opts.refreshMs ? setInterval(() => load(path), opts.refreshMs) : null;
    return () => {
      subs.get(path)?.delete(f);
      if (t) clearInterval(t);
    };
  }, [path, opts.refreshMs]);
  const e = path ? cache.get(path) : undefined;
  const reload = useCallback(() => (path ? load(path) : Promise.resolve()), [path]);
  return { data: e?.data as T | undefined, error: e?.error, loading: !!path && e?.data === undefined && !e?.error, reload };
}

export const useMe = () => useApi<{ admin: Admin | null; stage: Stage }>("/me");
