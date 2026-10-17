import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// ---------- ids ----------
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Sortable, unguessable ids: prefix + 10 time chars + 12 random chars. */
export function newId(prefix: string): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const r = randomBytes(12);
  let rand = "";
  for (const b of r) rand += CROCKFORD[b % 32];
  return `${prefix}_${time}${rand}`;
}

export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- passwords ----------
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptAsync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${dk.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const dk = await scryptAsync(pw, Buffer.from(s, "base64"), 32, SCRYPT);
  const want = Buffer.from(h, "base64");
  return dk.length === want.length && timingSafeEqual(dk, want);
}

// ---------- secrets at rest (AES-256-GCM) ----------
export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function open(key: Buffer, sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1") throw new Error("unknown sealed format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------- errors ----------
export type ErrType = "invalid_request" | "authentication_error" | "permission_error" | "balance_error" | "rate_limit_error" | "mpesa_error" | "api_error" | "not_found";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public type: ErrType = "invalid_request",
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const bad = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(400, code, message, "invalid_request", details);
export const notFound = (what = "resource") => new ApiError(404, "not_found", `No such ${what}.`, "not_found");

// ---------- phones ----------
/** 0712345678 / +254712345678 / 712345678 / 254712345678 → 254712345678, or null. */
export function normalisePhone(input: string): string | null {
  const d = String(input).replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return null;
}

// ---------- time ----------
/** Daraja wants Kenyan wall-clock time as YYYYMMDDHHmmss. Kenya has no DST. */
export function darajaTimestamp(d = new Date()) {
  const k = new Date(d.getTime() + 3 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`;
}

export const kes = (cents: number) => Math.round(cents) / 100;
