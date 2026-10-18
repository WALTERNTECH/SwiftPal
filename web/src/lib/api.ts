"use client";

// The dashboard's only way to the server: /backend/* is proxied to the API
// (next.config.ts). Responses are cached per path; mutations invalidate by
// prefix and every subscriber refetches.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SITE } from "./site";

export type Mode = "test" | "live";
export type Account = "fee" | "float";

// ---------- shapes returned by the API ----------
export type User = { id: string; email: string; phone: string; first_name: string; last_name: string; role: string; email_verified_at: string | null; phone_verified_at: string | null; created_at: string };
export type Merchant = {
  id: string;
  account_code: string;
  name: string;
  type: "individual" | "company" | "ngo";
  industry: string | null;
  monthly_volume: string | null;
  website: string | null;
  verification_status: "not_started" | "submitted" | "approved" | "rejected";
  auto_cover: boolean;
  low_balance_at: number;
  starter_credit_given: boolean;
  onboarding_done: boolean;
  live_enabled: boolean;
  created_at: string;
};
export type Bal = { available: number; held: number };
export type Balances = { fee_credit: Bal; payout_float: Bal; currency: "KES" };
export type Channel = {
  id: string;
  kind: "till" | "paybill";
  shortcode: string;
  account_number: string | null;
  display_name: string;
  status: "unverified" | "verifying" | "verified";
  is_default: boolean;
  credential_mode: "platform" | "linked";
  created_at: string;
  verified_at: string | null;
};
export type VerificationState = {
  id: string;
  kind: "individual" | "business";
  name: string;
  status: "submitted" | "approved" | "rejected";
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  documents: { doc_key: string; filename: string; content_type: string; size_bytes: number }[];
} | null;
export type Me = {
  user: User;
  merchant: Merchant;
  balances: Record<Mode, Balances>;
  channels: Channel[];
  verification: VerificationState;
  live_available: boolean;
  /** One-time codes at sign-up and sign-in; off until SMS and email are set up. */
  codes: boolean;
  pending: Partial<Record<Mode, number>>;
};
export type PayStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";
export type Payment = {
  id: string;
  status: PayStatus;
  amount: number;
  phone: string;
  reference: string;
  description: string | null;
  channel: string | null;
  mpesa_receipt: string | null;
  failure_code: string | null;
  failure_message: string | null;
  fee: { amount: number; charged: boolean };
  metadata: Record<string, unknown>;
  livemode: boolean;
  created_at: string;
  completed_at: string | null;
};
export type PayoutStatus = "processing" | "succeeded" | "failed" | "reversed";
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
  failure_code: string | null;
  failure_message: string | null;
  fee: { amount: number; refunded: boolean };
  livemode: boolean;
  created_at: string;
  completed_at: string | null;
};
export type ApiKey = { id: string; name: string; mode: Mode; secret: string | null; masked: string; scopes: string[]; created_at: string; last_used_at: string | null };
export type Endpoint = { id: string; url: string; events: string[]; enabled: boolean; secret: string; created_at: string };
export type Delivery = {
  id: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  last_duration_ms: number | null;
  last_attempt_at: string | null;
  next_attempt_at: string;
  created_at: string;
  event_id: string;
  type: string;
  object_id: string | null;
  url: string;
};
export type LedgerRow = { id: string; account: Account; kind: string; amount: number; ref: string | null; created_at: string };
export type LogRow = { id: string; method: string; path: string; status: number; duration_ms: number; request_body: unknown; response_body: unknown; created_at: string };
export type Summary = {
  collected: number;
  paid_out: number;
  successful: number;
  prompts: number;
  settled: number;
  success_rate: number | null;
  average_ticket: number | null;
  fees: number;
  payouts: number;
  payouts_failed: number;
};
export type Analytics = {
  mode: Mode;
  days: number;
  current: Summary;
  previous: Summary;
  series: { date: string; collected: number; paid_out: number; prompts: number; successful: number; settled: number }[];
  outcomes: { key: string; label: string; code: string; count: number }[];
  hours: { hour: number; successful: number }[];
  ticket_bands: { label: string; count: number }[];
  payout_reasons: { reason: string; amount: number }[];
};

// ---------- transport ----------
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// The API sleeps when idle on Render's free plan. Only a request from outside
// Render wakes it: calls the web server forwards get Render's own 502/503/504
// page and never reach the API. So the browser pings the API directly (an
// opaque no-cors GET is enough), then waits for /health through the proxy and
// sends the original request again; it never reached the API the first time.
const API_ORIGIN = SITE.apiBase.replace(/\/v1$/, "");
let waking: Promise<void> | null = null;
let wakingNow = false;
const wakeSubs = new Set<() => void>();
const setWaking = (v: boolean) => {
  wakingNow = v;
  wakeSubs.forEach((f) => f());
};

export function wakeApi(): Promise<void> {
  waking ??= (async () => {
    const ping = () => fetch(`${API_ORIGIN}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
    const healthy = async () => {
      try {
        return (await fetch("/backend/health", { cache: "no-store" })).ok;
      } catch {
        return false;
      }
    };
    if (await healthy()) return;
    setWaking(true);
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
    throw new ApiError(503, "unavailable", "SwiftPal is unavailable right now. Try again in a minute.");
  })().finally(() => {
    setWaking(false);
    setTimeout(() => (waking = null), 0);
  });
  return waking;
}

/** True while the API is being started, so a form can say why it's taking a moment. */
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

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}, attempt = 0): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  let res: Response;
  try {
    res = await fetch(`/backend${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "SwiftPal", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach SwiftPal. Check your connection and try again.");
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string; details?: Record<string, unknown> } } | null)?.error;
    if (!e && (res.status === 502 || res.status === 503 || res.status === 504)) {
      if (attempt >= 1) throw new ApiError(res.status, "unavailable", "SwiftPal is unavailable right now. Try again in a minute.");
      await wakeApi();
      return api<T>(path, opts, attempt + 1);
    }
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status}).`, e?.details);
  }
  return json as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ---------- cache ----------
type Entry = { data?: unknown; error?: ApiError; at: number; inflight?: Promise<unknown> };
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((f) => f());
}

async function load(key: string) {
  const e = cache.get(key) ?? { at: 0 };
  if (e.inflight) return e.inflight;
  e.inflight = api(key)
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
    })
    .catch((error: ApiError) => {
      cache.set(key, { data: e.data, error, at: Date.now() });
    })
    .finally(() => notify(key));
  cache.set(key, e);
  return e.inflight;
}

/** Refetch every cached path starting with one of the prefixes; resolves when they've landed. */
export function invalidate(...prefixes: string[]) {
  return Promise.all([...cache.keys()].filter((key) => prefixes.some((p) => key.startsWith(p))).map(load));
}

export function clearCache() {
  cache.clear();
}

/** Subscribes to GET `path`; null skips. Polls every `refreshMs` while mounted. */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!path) return;
    const f = () => force((n) => n + 1);
    if (!subs.has(path)) subs.set(path, new Set());
    subs.get(path)!.add(f);
    const e = cache.get(path);
    if (!e || Date.now() - e.at > 5_000) load(path);
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

/** Polls a payment until it leaves pending, then refreshes everything it touched. */
export function usePaymentWatch(id: string | null) {
  const [settled, setSettled] = useState(false);
  const { data } = useApi<Payment>(id ? `/app/payments/${id}` : null, { refreshMs: settled ? undefined : 1500 });
  const prev = useRef<string | null>(null);
  const current = data && data.id === id ? data : undefined;
  useEffect(() => {
    setSettled(!!current && current.status !== "pending");
    if (current && current.status !== "pending" && prev.current === "pending") invalidate("/app/me", "/app/payments", "/app/analytics", "/app/wallet", "/app/ledger", "/app/channels");
    prev.current = current?.status ?? null;
  }, [current]);
  return current;
}

// ---------- mode ----------
/** The dashboard runs in live mode only; the API keeps test mode for its own test suite. */
export const useMode = (): Mode => "live";

export const useMe = () => useApi<Me>("/app/me");

/** Where a signed-in account belongs: phone code, email code, onboarding, then the dashboard. */
export const nextStep = (me: Me) =>
  me.codes && !me.user.phone_verified_at
    ? "/verify-phone"
    : me.codes && !me.user.email_verified_at
      ? "/verify-email"
      : !me.merchant.onboarding_done
        ? "/onboarding"
        : "/dashboard";

/** True until the account has proved what the current settings ask for. */
export const needsCodes = (me: Me) => me.codes && (!me.user.phone_verified_at || !me.user.email_verified_at);

/** Inside the dashboard shell, which renders nothing until /app/me has loaded. */
export function useAccount(): Me {
  return useApi<Me>("/app/me").data!;
}

/** Cursor paging over a list endpoint whose `base` path already carries its filters. */
export function usePaged<T extends { id: string }>(base: string, size = 25, refreshMs?: number) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [forBase, setForBase] = useState(base);
  if (forBase !== base) {
    setForBase(base);
    setCursors([]);
  }
  const before = forBase === base ? cursors[cursors.length - 1] : undefined;
  const path = `${base}${base.includes("?") ? "&" : "?"}limit=${size + 1}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const r = useApi<T[]>(path, { refreshMs });
  // Keep the previous page on screen while the next one loads.
  const last = useRef<T[] | undefined>(undefined);
  if (r.data) last.current = r.data;
  const data = r.data ?? last.current;
  const rows = data?.slice(0, size) ?? [];
  return {
    rows,
    error: r.error,
    loading: !data && !r.error,
    page: cursors.length,
    size,
    hasNext: (data?.length ?? 0) > size,
    next: () => rows.length && setCursors((c) => [...c, rows[rows.length - 1].id]),
    prev: () => setCursors((c) => c.slice(0, -1)),
  };
}

export const usePayments = (mode: Mode, refreshMs?: number) => useApi<Payment[]>(`/app/payments?mode=${mode}`, { refreshMs });
export const usePayouts = (mode: Mode, refreshMs?: number) => useApi<Payout[]>(`/app/payouts?mode=${mode}`, { refreshMs });
