"use client";

// Prototype state for the merchant console. Everything lives in localStorage
// so the flows can be clicked through end to end before the API exists. Each
// action here maps to one API call in the backend phase.

import { useSyncExternalStore } from "react";
import { b2cFee, stkFee, STARTER_CREDIT } from "./pricing";
import { SANDBOX_NUMBERS } from "./site";

export type Mode = "test" | "live";
export type BusinessType = "individual" | "company" | "ngo";
export type Verification = "not_started" | "submitted" | "approved";

export type Account = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  createdAt: string;
};

export type Business = {
  type: BusinessType;
  name: string;
  industry: string;
  monthlyVolume: string;
  website: string;
};

export type Channel = {
  id: string;
  kind: "till" | "paybill";
  shortcode: string;
  accountNumber?: string;
  label: string;
  displayName: string;
  status: "unverified" | "verified";
  isDefault: boolean;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  name: string;
  mode: Mode;
  secret: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revealed: boolean;
};

export type Webhook = {
  id: string;
  url: string;
  events: string[];
  secret: string;
  mode: Mode;
  enabled: boolean;
  createdAt: string;
};

export type PayStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";
export type Payment = {
  id: string;
  mode: Mode;
  phone: string;
  amount: number;
  reference: string;
  channel: string;
  status: PayStatus;
  receipt: string | null;
  fee: number;
  feeCharged: boolean;
  failureCode: string | null;
  createdAt: string;
  sample?: boolean;
};

export type PayoutStatus = "processing" | "succeeded" | "failed";
export type Payout = {
  id: string;
  mode: Mode;
  phone: string;
  recipient: string | null;
  amount: number;
  reference: string;
  reason: string;
  status: PayoutStatus;
  receipt: string | null;
  fee: number;
  batch: string | null;
  createdAt: string;
  sample?: boolean;
};

export type LedgerEntry = {
  id: string;
  mode: Mode;
  balance: "fee" | "float";
  kind: "top_up" | "fee" | "fee_release" | "payout" | "payout_refund" | "withdrawal" | "starter_credit";
  amount: number;
  ref: string | null;
  createdAt: string;
};

export type Balances = { fee: number; float: number };

export type State = {
  version: 1;
  signedIn: boolean;
  account: Account | null;
  business: Business | null;
  onboardingDone: boolean;
  mode: Mode;
  channels: Channel[];
  balances: Record<Mode, Balances>;
  autoCover: boolean;
  lowBalanceAt: number;
  verification: Verification;
  keys: ApiKey[];
  webhooks: Webhook[];
  payments: Payment[];
  payouts: Payout[];
  ledger: LedgerEntry[];
  starterCreditGiven: boolean;
};

const KEY = "swiftpal:prototype:v1";

const empty = (): State => ({
  version: 1,
  signedIn: false,
  account: null,
  business: null,
  onboardingDone: false,
  mode: "test",
  channels: [],
  balances: { test: { fee: 10_000, float: 100_000 }, live: { fee: 0, float: 0 } },
  autoCover: false,
  lowBalanceAt: 200,
  verification: "not_started",
  keys: [],
  webhooks: [],
  payments: [],
  payouts: [],
  ledger: [],
  starterCreditGiven: false,
});

// ---------- ids ----------
const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function rand(n: number, alphabet = ALPHA) {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
export const newId = (prefix: string) => `${prefix}_01J${rand(11)}`;
const receipt = () => "T" + rand(9, "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789");
const secretKey = (mode: Mode) => `sp_${mode}_${rand(28, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
const whsec = () => `whsec_${rand(32, "abcdefghijkmnopqrstuvwxyz0123456789")}`;

// ---------- store plumbing ----------
let state: State = empty();
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.version === 1) state = { ...empty(), ...parsed };
    }
  } catch {
    /* private mode or corrupt; start fresh */
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked; state still works for this tab */
  }
}

function set(fn: (s: State) => State) {
  load();
  state = fn(state);
  persist();
  listeners.forEach((l) => l());
}

export function getState() {
  load();
  return state;
}

const SERVER = empty();
export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          loaded = false;
          load();
          l();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    getState,
    () => SERVER,
  );
}

/** True once the client has read localStorage, so guards don't redirect on the server snapshot. */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// ---------- auth ----------
export function signUp(a: Omit<Account, "emailVerified" | "createdAt">) {
  set(() => ({
    ...empty(),
    signedIn: true,
    account: { ...a, emailVerified: false, createdAt: new Date().toISOString() },
  }));
}

export function verifyEmail() {
  set((s) => {
    if (!s.account) return s;
    const now = new Date().toISOString();
    return {
      ...s,
      account: { ...s.account, emailVerified: true },
      keys: s.keys.length
        ? s.keys
        : [
            {
              id: newId("key"),
              name: "Default test key",
              mode: "test",
              secret: secretKey("test"),
              scopes: ["payments:write", "payouts:write", "read"],
              createdAt: now,
              lastUsedAt: null,
              revealed: false,
            },
          ],
      payments: s.payments.length ? s.payments : samplePayments(),
      payouts: s.payouts.length ? s.payouts : samplePayouts(),
    };
  });
}

export function signIn(email: string) {
  set((s) => {
    if (s.account && s.account.email.toLowerCase() === email.toLowerCase()) return { ...s, signedIn: true };
    // Prototype: an unknown email signs into a fresh demo account.
    const [first] = email.split("@");
    const name = first.replace(/[^a-z]/gi, " ").trim() || "Developer";
    return {
      ...empty(),
      signedIn: true,
      account: {
        firstName: name.charAt(0).toUpperCase() + name.slice(1),
        lastName: "",
        email,
        phone: "254712345678",
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
      business: { type: "company", name: "Demo Traders Ltd", industry: "E-commerce", monthlyVolume: "100k-1m", website: "" },
      onboardingDone: true,
      keys: [
        {
          id: newId("key"),
          name: "Default test key",
          mode: "test",
          secret: secretKey("test"),
          scopes: ["payments:write", "payouts:write", "read"],
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date(Date.now() - 3_600_000).toISOString(),
          revealed: false,
        },
      ],
      payments: samplePayments(),
      payouts: samplePayouts(),
    };
  });
}

export function signOut() {
  set((s) => ({ ...s, signedIn: false }));
}

export function resetPrototype() {
  set(() => empty());
}

// ---------- onboarding ----------
export function saveBusiness(b: Business) {
  set((s) => ({ ...s, business: b }));
}

export function finishOnboarding() {
  set((s) => ({ ...s, onboardingDone: true }));
}

export function addChannel(c: Pick<Channel, "kind" | "shortcode" | "accountNumber" | "label" | "displayName">) {
  const id = `${c.kind}_${c.shortcode}`;
  set((s) => {
    if (s.channels.some((x) => x.id === id)) return s;
    return {
      ...s,
      channels: [
        ...s.channels,
        { ...c, id, status: "unverified", isDefault: s.channels.length === 0, createdAt: new Date().toISOString() },
      ],
    };
  });
  return id;
}

export function verifyChannel(id: string) {
  set((s) => {
    const channels = s.channels.map((c) => (c.id === id ? { ...c, status: "verified" as const } : c));
    if (s.starterCreditGiven) return { ...s, channels };
    const now = new Date().toISOString();
    const hasLiveKey = s.keys.some((k) => k.mode === "live");
    return {
      ...s,
      channels,
      starterCreditGiven: true,
      balances: { ...s.balances, live: { ...s.balances.live, fee: s.balances.live.fee + STARTER_CREDIT } },
      ledger: [
        { id: newId("led"), mode: "live", balance: "fee", kind: "starter_credit", amount: STARTER_CREDIT, ref: null, createdAt: now },
        ...s.ledger,
      ],
      keys: hasLiveKey
        ? s.keys
        : [
            ...s.keys,
            {
              id: newId("key"),
              name: "Default live key",
              mode: "live",
              secret: secretKey("live"),
              scopes: ["payments:write", "read"],
              createdAt: now,
              lastUsedAt: null,
              revealed: false,
            },
          ],
    };
  });
}

export function removeChannel(id: string) {
  set((s) => {
    const left = s.channels.filter((c) => c.id !== id);
    if (left.length && !left.some((c) => c.isDefault)) left[0] = { ...left[0], isDefault: true };
    return { ...s, channels: left };
  });
}

export function setDefaultChannel(id: string) {
  set((s) => ({ ...s, channels: s.channels.map((c) => ({ ...c, isDefault: c.id === id })) }));
}

// ---------- settings ----------
export const setMode = (mode: Mode) => set((s) => ({ ...s, mode }));
export const setAutoCover = (on: boolean) => set((s) => ({ ...s, autoCover: on }));
export const setLowBalanceAt = (n: number) => set((s) => ({ ...s, lowBalanceAt: n }));
export const submitVerification = () => set((s) => ({ ...s, verification: "submitted" }));
export const approveVerification = () =>
  set((s) => ({
    ...s,
    verification: "approved",
    keys: s.keys.map((k) => (k.mode === "live" && !k.scopes.includes("payouts:write") ? { ...k, scopes: [...k.scopes, "payouts:write"] } : k)),
  }));
export const updateAccount = (a: Partial<Account>) => set((s) => (s.account ? { ...s, account: { ...s.account, ...a } } : s));

// ---------- keys & webhooks ----------
export function createKey(name: string, mode: Mode, scopes: string[]) {
  const key: ApiKey = {
    id: newId("key"),
    name,
    mode,
    secret: secretKey(mode),
    scopes,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revealed: true,
  };
  set((s) => ({ ...s, keys: [...s.keys, key] }));
  return key;
}
export const revokeKey = (id: string) => set((s) => ({ ...s, keys: s.keys.filter((k) => k.id !== id) }));
export const rollKey = (id: string) =>
  set((s) => ({ ...s, keys: s.keys.map((k) => (k.id === id ? { ...k, secret: secretKey(k.mode), createdAt: new Date().toISOString(), revealed: true } : k)) }));

export function addWebhook(url: string, events: string[], mode: Mode) {
  const w: Webhook = { id: newId("we"), url, events, secret: whsec(), mode, enabled: true, createdAt: new Date().toISOString() };
  set((s) => ({ ...s, webhooks: [...s.webhooks, w] }));
  return w;
}
export const removeWebhook = (id: string) => set((s) => ({ ...s, webhooks: s.webhooks.filter((w) => w.id !== id) }));
export const toggleWebhook = (id: string) =>
  set((s) => ({ ...s, webhooks: s.webhooks.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)) }));

// ---------- money ----------
export function topUp(mode: Mode, balance: "fee" | "float", amount: number) {
  set((s) => ({
    ...s,
    balances: {
      ...s.balances,
      [mode]: { ...s.balances[mode], [balance]: s.balances[mode][balance] + amount },
    },
    ledger: [
      { id: newId("led"), mode, balance, kind: "top_up", amount, ref: receipt(), createdAt: new Date().toISOString() },
      ...s.ledger,
    ],
  }));
}

export function withdrawFloat(mode: Mode, amount: number) {
  const f = b2cFee(amount) ?? 0;
  set((s) => {
    const b = s.balances[mode];
    return {
      ...s,
      balances: { ...s.balances, [mode]: { fee: b.fee - f, float: b.float - amount } },
      ledger: [
        { id: newId("led"), mode, balance: "float", kind: "withdrawal", amount: -amount, ref: null, createdAt: new Date().toISOString() },
        { id: newId("led"), mode, balance: "fee", kind: "fee", amount: -f, ref: "withdrawal", createdAt: new Date().toISOString() },
        ...s.ledger,
      ],
    };
  });
}

export type SimResult = { ok: true; payment: Payment } | { ok: false; code: string; message: string };

/** Sandbox STK Push. Resolves the outcome from the magic numbers after a delay, like the real thing. */
export function simulateStk(input: { phone: string; amount: number; reference: string; channel?: string }): SimResult {
  const s = getState();
  const mode = s.mode;
  const f = stkFee(input.amount) ?? 0;
  const bal = s.balances[mode];
  if (mode === "live" && !s.channels.some((c) => c.status === "verified")) {
    return { ok: false, code: "account_not_live", message: "Verify a Till or Paybill before sending live prompts." };
  }
  if (bal.fee < f && !(s.autoCover && bal.float >= f)) {
    return { ok: false, code: "insufficient_fee_credit", message: `Fee credit is KES ${bal.fee.toFixed(2)} and this request needs KES ${f.toFixed(2)} held.` };
  }
  const channel = input.channel ?? s.channels.find((c) => c.isDefault)?.id ?? "till_5521093";
  const p: Payment = {
    id: newId("pay"),
    mode,
    phone: input.phone,
    amount: input.amount,
    reference: input.reference,
    channel,
    status: "pending",
    receipt: null,
    fee: f,
    feeCharged: false,
    failureCode: null,
    createdAt: new Date().toISOString(),
  };
  set((st) => ({ ...st, payments: [p, ...st.payments] }));

  const magic = SANDBOX_NUMBERS.find((n) => n.phone === input.phone);
  const outcome: PayStatus = !magic || magic.outcome === "success" ? "succeeded" : (magic.outcome as PayStatus);
  setTimeout(() => {
    set((st) => {
      const succeeded = outcome === "succeeded";
      const useFloat = succeeded && st.balances[mode].fee < f && st.autoCover;
      const b = st.balances[mode];
      return {
        ...st,
        payments: st.payments.map((x) =>
          x.id === p.id
            ? { ...x, status: outcome, receipt: succeeded ? receipt() : null, feeCharged: succeeded && f > 0, failureCode: succeeded ? null : magic?.code ?? null }
            : x,
        ),
        balances: succeeded && f > 0
          ? { ...st.balances, [mode]: useFloat ? { ...b, float: b.float - f } : { ...b, fee: b.fee - f } }
          : st.balances,
        ledger: succeeded && f > 0
          ? [{ id: newId("led"), mode, balance: useFloat ? "float" : "fee", kind: "fee", amount: -f, ref: p.id, createdAt: new Date().toISOString() }, ...st.ledger]
          : st.ledger,
      };
    });
  }, 4500);
  return { ok: true, payment: p };
}

export function simulatePayout(input: { phone: string; amount: number; reference: string; reason: string; batch?: string }):
  | { ok: true; payout: Payout }
  | { ok: false; code: string; message: string } {
  const s = getState();
  const mode = s.mode;
  const f = b2cFee(input.amount);
  if (f === null) return { ok: false, code: "invalid_amount", message: "Payouts run from KES 10 to KES 250,000." };
  if (mode === "live" && s.verification !== "approved") {
    return { ok: false, code: "payouts_not_enabled", message: "Live payouts open once your business details are approved." };
  }
  const bal = s.balances[mode];
  if (bal.float < input.amount) return { ok: false, code: "insufficient_float", message: `Payout float is KES ${bal.float.toLocaleString()}.` };
  if (bal.fee < f && !(s.autoCover && bal.float >= input.amount + f)) {
    return { ok: false, code: "insufficient_fee_credit", message: `This payout needs KES ${f} fee credit.` };
  }
  const useFloat = bal.fee < f;
  const po: Payout = {
    id: newId("po"),
    mode,
    phone: input.phone,
    recipient: null,
    amount: input.amount,
    reference: input.reference,
    reason: input.reason,
    status: "processing",
    receipt: null,
    fee: f,
    batch: input.batch ?? null,
    createdAt: new Date().toISOString(),
  };
  set((st) => {
    const b = st.balances[mode];
    return {
      ...st,
      payouts: [po, ...st.payouts],
      balances: {
        ...st.balances,
        [mode]: useFloat ? { ...b, float: b.float - input.amount - f } : { fee: b.fee - f, float: b.float - input.amount },
      },
      ledger: [
        { id: newId("led"), mode, balance: "float", kind: "payout", amount: -input.amount, ref: po.id, createdAt: po.createdAt },
        { id: newId("led"), mode, balance: useFloat ? "float" : "fee", kind: "fee", amount: -f, ref: po.id, createdAt: po.createdAt },
        ...st.ledger,
      ],
    };
  });
  const magic = SANDBOX_NUMBERS.find((n) => n.phone === input.phone);
  const fails = magic && magic.outcome !== "success";
  setTimeout(() => {
    set((st) => {
      const b = st.balances[mode];
      return {
        ...st,
        payouts: st.payouts.map((x) =>
          x.id === po.id
            ? { ...x, status: fails ? "failed" : "succeeded", receipt: fails ? null : receipt(), recipient: fails ? null : pickName(input.phone) }
            : x,
        ),
        balances: fails
          ? {
              ...st.balances,
              [mode]: useFloat ? { ...b, float: b.float + input.amount + f } : { fee: b.fee + f, float: b.float + input.amount },
            }
          : st.balances,
        ledger: fails
          ? [
              { id: newId("led"), mode, balance: "float", kind: "payout_refund", amount: input.amount, ref: po.id, createdAt: new Date().toISOString() },
              { id: newId("led"), mode, balance: useFloat ? "float" : "fee", kind: "fee_release", amount: f, ref: po.id, createdAt: new Date().toISOString() },
              ...st.ledger,
            ]
          : st.ledger,
      };
    });
  }, 3500 + Math.random() * 2500);
  return { ok: true, payout: po };
}

// ---------- sample data (test mode only) ----------
const NAMES = ["JOHN KAMAU", "MERCY WANJIKU", "BRIAN OTIENO", "FAITH CHEBET", "KEVIN MWANGI", "ANN NJERI", "DAVID KIPRONO", "GRACE AKINYI", "PETER NDUNGU", "LUCY MUTHONI"];
function pickName(phone: string) {
  let h = 0;
  for (const ch of phone) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAMES[h % NAMES.length];
}

function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function samplePhone(r: () => number) {
  const pre = ["2547", "2547", "2547", "2541"][Math.floor(r() * 4)];
  return pre + String(Math.floor(r() * 1e8)).padStart(8, "0");
}

function samplePayments(): Payment[] {
  const r = seeded(7);
  const now = Date.now();
  const amounts = [150, 250, 300, 450, 500, 650, 800, 1000, 1200, 1250, 1500, 2000, 2400, 3500, 4999, 7800, 12000];
  const out: Payment[] = [];
  for (let i = 0; i < 64; i++) {
    const roll = r();
    const status: PayStatus = roll < 0.74 ? "succeeded" : roll < 0.86 ? "cancelled" : roll < 0.94 ? "expired" : "failed";
    const amount = amounts[Math.floor(r() * amounts.length)];
    const createdAt = new Date(now - (i * 5 + r() * 3) * 3_600_000).toISOString();
    const f = stkFee(amount) ?? 0;
    out.push({
      id: `pay_01JSAMPLE${String(1000 + i)}${rand(2)}`,
      mode: "test",
      phone: samplePhone(r),
      amount,
      reference: `ORD-${String(8841 - i)}`,
      channel: "till_5521093",
      status,
      receipt: status === "succeeded" ? receipt() : null,
      fee: f,
      feeCharged: status === "succeeded" && f > 0,
      failureCode: status === "failed" ? "1" : status === "cancelled" ? "1032" : status === "expired" ? "1037" : null,
      createdAt,
      sample: true,
    });
  }
  return out;
}

function samplePayouts(): Payout[] {
  const r = seeded(19);
  const now = Date.now();
  const amounts = [500, 1000, 1500, 2500, 3500, 5000, 8000, 12500, 18500, 21000];
  const reasons = ["withdrawal", "salary", "refund", "commission"];
  const out: Payout[] = [];
  for (let i = 0; i < 26; i++) {
    const phone = samplePhone(r);
    const amount = amounts[Math.floor(r() * amounts.length)];
    const ok = r() > 0.08;
    out.push({
      id: `po_01JSAMPLE${String(500 + i)}${rand(2)}`,
      mode: "test",
      phone,
      recipient: ok ? pickName(phone) : null,
      amount,
      reference: `WD-${20931 - i}`,
      reason: reasons[Math.floor(r() * reasons.length)],
      status: ok ? "succeeded" : "failed",
      receipt: ok ? receipt() : null,
      fee: b2cFee(amount) ?? 0,
      batch: i >= 6 && i < 12 ? "bat_01JPAYROLL0926" : null,
      createdAt: new Date(now - (i * 6.5 + r() * 4) * 3_600_000).toISOString(),
      sample: true,
    });
  }
  return out;
}
