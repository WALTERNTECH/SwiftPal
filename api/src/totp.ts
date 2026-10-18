import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./lib.js";

// Time-based one-time codes (RFC 6238) for admin and merchant sign-in: the
// codes an authenticator app such as Google Authenticator or 1Password shows.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(s: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("not base32");
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32(randomBytes(20));

export function hotp(secret: string, counter: number, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

/**
 * Accepts the current 30-second step and one either side for clock drift.
 * Returns the step that matched so it can't be used twice, or null.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (safeEqual(hotp(secret, s), code)) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer = "SwiftPal Admin") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

/** The step a code belongs to, ignoring replay protection: tells "already used" apart from "wrong". */
export function matchedStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (const s of [step - 1, step, step + 1]) if (safeEqual(hotp(secret, s), code)) return s;
  return null;
}
