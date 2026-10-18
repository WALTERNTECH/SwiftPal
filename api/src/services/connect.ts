import { randomInt } from "node:crypto";
import type { App } from "../app.js";
import { one } from "../db.js";
import { ApiError, open, seal, sha256, token } from "../lib.js";
import { assertActive, getMerchant, insertKey, SCOPES } from "./accounts.js";

// Connecting an AI assistant or CLI without copying a key: the tool starts a
// request and shows the merchant a short code; the merchant approves it in the
// dashboard; the tool collects a fresh live key once. The same shape as the
// OAuth device flow (RFC 8628), cut down to what an API key needs.

const TTL_MINUTES = 10;
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"; // no vowels, no 0/O or 1/I

type Request = {
  device_hash: string;
  user_code: string;
  client_name: string;
  status: "pending" | "approved" | "denied" | "claimed";
  merchant_id: string | null;
  secret_enc: string | null;
  expired: boolean;
  created_at: string;
};

const userCode = () => {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

export async function start(app: App, clientName: string | undefined, ip?: string) {
  const recent = await one<{ n: number }>(app.db, `select count(*)::int as n from connect_requests where ip = $1 and created_at > now() - interval '10 minutes'`, [ip ?? ""]);
  if (recent && recent.n >= 10) throw new ApiError(429, "too_many_requests", "Too many connection requests. Try again in a few minutes.", "rate_limit_error");
  const device = token(32);
  const code = userCode();
  const name = (clientName ?? "").replace(/[^\w .()'-]/g, "").trim().slice(0, 60) || "AI assistant";
  await app.db.query(
    `insert into connect_requests (device_hash, user_code, client_name, ip, expires_at) values ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
    [sha256(device), code, name, ip ?? null, String(TTL_MINUTES)],
  );
  return {
    device_code: device,
    user_code: code,
    approve_url: `${app.cfg.webUrl}/connect?code=${code}`,
    token_url: `${app.cfg.publicUrl}/connect/token`,
    interval: 3,
    expires_in: TTL_MINUTES * 60,
  };
}

const byCode = (app: App, code: string) =>
  one<Request>(
    app.db,
    `select device_hash, user_code, client_name, status, merchant_id, secret_enc, expires_at < now() as expired, created_at from connect_requests where user_code = $1`,
    [code.trim().toUpperCase()],
  );

export async function describe(app: App, code: string) {
  const r = await byCode(app, code);
  if (!r) throw new ApiError(404, "not_found", "That connection code doesn't exist. Ask your assistant for a new one.", "not_found");
  return { user_code: r.user_code, client_name: r.client_name, status: r.expired && r.status === "pending" ? "expired" : r.status, created_at: r.created_at };
}

/** The merchant says yes: a new live key is made and held, sealed, for the tool to collect once. */
export async function approve(app: App, merchantId: string, code: string, scopes: string[]) {
  const wanted = scopes.filter((s) => (SCOPES as readonly string[]).includes(s));
  if (!wanted.length) throw new ApiError(400, "invalid_scopes", "Choose at least one permission.");
  return app.db.tx(async (q) => {
    const r = await one<Request>(q, `select *, expires_at < now() as expired from connect_requests where user_code = $1 for update`, [code.trim().toUpperCase()]);
    if (!r) throw new ApiError(404, "not_found", "That connection code doesn't exist.", "not_found");
    if (r.expired) throw new ApiError(410, "expired", "This request has expired. Ask your assistant to start again.");
    if (r.status !== "pending") throw new ApiError(409, "already_answered", "This request was already answered.");
    const m = await getMerchant(q, merchantId);
    assertActive(m);
    if (!m.live_enabled) throw new ApiError(403, "account_not_live", "API keys open once your account is verified.", "permission_error");
    if (wanted.includes("payouts:write") && m.verification_status !== "approved")
      throw new ApiError(403, "payouts_not_enabled", "Payouts need a verified account.", "permission_error");
    const key = await insertKey(app, q, merchantId, "live", `${r.client_name} (connected)`, wanted);
    await q.query(`update connect_requests set status = 'approved', merchant_id = $2, secret_enc = $3, approved_at = now() where device_hash = $1`, [
      r.device_hash,
      merchantId,
      seal(app.cfg.masterKey, key.secret),
    ]);
    return { client_name: r.client_name };
  });
}

export async function deny(app: App, code: string) {
  const { rows } = await app.db.query(`update connect_requests set status = 'denied' where user_code = $1 and status = 'pending' returning user_code`, [code.trim().toUpperCase()]);
  if (!rows.length) throw new ApiError(409, "already_answered", "This request was already answered or has expired.");
}

/** The tool polls this. The key is handed over exactly once, then forgotten. */
export async function collect(app: App, device: string) {
  return app.db.tx(async (q) => {
    const r = await one<Request>(q, `select *, expires_at < now() as expired from connect_requests where device_hash = $1 for update`, [sha256(device)]);
    if (!r) throw new ApiError(404, "not_found", "Unknown device_code.", "not_found");
    if (r.status === "denied") throw new ApiError(403, "access_denied", "The account owner declined this connection.", "permission_error");
    if (r.status === "claimed") throw new ApiError(410, "already_claimed", "This key was already collected. Start a new connection.");
    if (r.status === "pending") {
      if (r.expired) throw new ApiError(410, "expired", "The request expired before it was approved. Start a new connection.");
      return { status: "pending" as const };
    }
    await q.query(`update connect_requests set status = 'claimed', secret_enc = null, claimed_at = now() where device_hash = $1`, [r.device_hash]);
    const m = await getMerchant(q, r.merchant_id!);
    return {
      status: "approved" as const,
      secret_key: open(app.cfg.masterKey, r.secret_enc!),
      account: { name: m.name, account_code: m.account_code },
      api_base: `${app.cfg.publicUrl}/v1`,
      docs: `${app.cfg.webUrl}/llms.txt`,
    };
  });
}
