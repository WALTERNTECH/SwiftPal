import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { resetLimits } from "../src/limits.js";
import { createPayout } from "../src/services/payouts.js";
import { forgetSettings } from "../src/services/platform.js";
import { privateAddress } from "../src/services/webhooks.js";
import { hotp } from "../src/totp.js";
import { boot, enableTwoFactor, form, JPEG, merchant, stop, waitFor, type Ctx } from "./helpers.js";

let c: Ctx;
before(async () => {
  // Codes off, as in production today: a password alone signs in unless two-step is on.
  c = await boot({ WEB_PROXY_SECRET: "proxy-secret-for-tests", VERIFICATION_CODES: "off" });
});
after(async () => {
  await stop(c);
});

type M = Awaited<ReturnType<typeof merchant>>;
const ADMIN = { authorization: "Bearer admin-token-for-tests" };
const admin = (method: string, url: string, payload?: unknown) => c.api.inject({ method: method as never, url, payload: payload as never, headers: ADMIN });

async function approve(m: M) {
  const f = form(
    { kind: "individual", name: "Amina Otieno", id_number: "31234567" },
    { id_front: { name: "f.jpg", type: "image/jpeg", bytes: JPEG }, id_back: { name: "b.jpg", type: "image/jpeg", bytes: JPEG }, selfie: { name: "s.jpg", type: "image/jpeg", bytes: JPEG } },
  );
  const sub = await c.api.inject({ method: "POST", url: "/app/verification", payload: f.body, headers: { "content-type": f.contentType, cookie: m.cookie, "x-requested-with": "SwiftPal" } });
  assert.equal(sub.statusCode, 201, sub.body);
  assert.equal((await admin("POST", `/admin/verifications/${sub.json().id}/approve`)).statusCode, 200);
}

/** Live M-Pesa answered by the sandbox driver, a funded float, and a till that takes payments. */
async function goLive(m: M) {
  await approve(m);
  c.app.mpesa.live ??= c.app.mpesa.test;
  await c.app.db.query(`update balances set available_cents = 10000000 where merchant_id = $1 and mode = 'live'`, [m.merchantId]);
  const shortcode = String(5_000_000 + Math.floor(Math.random() * 999_999));
  const ch = await m.dash("POST", "/app/channels", { kind: "till", shortcode, display_name: "Amina Stores" });
  assert.equal(ch.statusCode, 201, ch.body);
}

const signIn = (email: string, password = "correct-horse-battery", remoteAddress = "127.0.0.1") =>
  c.api.inject({ method: "POST", url: "/app/auth/login", payload: { email, password }, remoteAddress });
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0];
const as = (cookie: string) => (method: string, url: string, payload?: unknown) =>
  c.api.inject({ method: method as never, url, payload: payload as never, headers: { cookie, "x-requested-with": "SwiftPal" } });

describe("rate limits and addresses", () => {
  it("locks an email after ten wrong passwords, from any address", async () => {
    const m = await merchant(c);
    resetLimits();
    for (let i = 0; i < 10; i++) assert.equal((await signIn(m.email, "wrong-password-x", `41.90.0.${i + 1}`)).statusCode, 401);
    const right = await signIn(m.email, "correct-horse-battery", "41.90.0.99");
    assert.equal(right.statusCode, 429, "the right password waits out the lock too");
    assert.ok(Number(right.headers["retry-after"]) > 0);
    const events = (await m.dash("GET", "/app/activity")).json() as { kind: string }[];
    assert.ok(events.filter((e) => e.kind === "sign_in_failed").length >= 10, "the owner can see the attempts");
  });

  it("caps sign-ups and reset emails per address", async () => {
    resetLimits();
    const signup = (i: number) =>
      c.api.inject({ method: "POST", url: "/app/auth/signup", remoteAddress: "41.80.1.1", payload: { first_name: "A", last_name: "B", email: `cap${i}${Date.now()}@example.com`, phone: `0711${String(i).padStart(6, "0")}`, password: "correct-horse-battery" } });
    for (let i = 0; i < 20; i++) assert.equal((await signup(i)).statusCode, 201);
    const over = await signup(21);
    assert.equal(over.statusCode, 429);
    assert.equal(over.json().error.type, "rate_limit_error");
    resetLimits();
    const forgot = () => c.api.inject({ method: "POST", url: "/app/auth/forgot", payload: { email: "someone@example.com" } });
    for (let i = 0; i < 3; i++) assert.equal((await forgot()).statusCode, 200);
    assert.equal((await forgot()).statusCode, 429);
  });

  it("trusts the visitor address only from the web server that knows the secret", async () => {
    const m = await merchant(c);
    const via = (headers: Record<string, string>) => c.api.inject({ method: "POST", url: "/app/auth/login", payload: { email: m.email, password: "correct-horse-battery" }, headers });
    const real = await via({ "x-swiftpal-proxy": "proxy-secret-for-tests", "x-swiftpal-client-ip": "41.90.64.7" });
    const spoof = await via({ "x-swiftpal-proxy": "guess", "x-swiftpal-client-ip": "8.8.8.8" });
    const sessions = (await as(cookieOf(real))("GET", "/app/security")).json().sessions as { ip: string }[];
    const ips = sessions.map((s) => s.ip);
    assert.ok(ips.includes("41.90.64.7"));
    assert.ok(!ips.includes("8.8.8.8"), "a wrong secret is ignored");
    assert.equal(spoof.statusCode, 200);
  });

  it("sends security headers and keeps account data out of caches", async () => {
    const m = await merchant(c);
    const res = await m.dash("GET", "/app/me");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
  });

  it("keeps the admin token off in production unless ADMIN_API=on", () => {
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", MASTER_KEY: "a".repeat(64), CALLBACK_TOKEN: "c".repeat(24), ADMIN_TOKEN: "t" };
    assert.equal(loadConfig(prod).adminApi, false);
    assert.equal(loadConfig({ ...prod, ADMIN_API: "on" }).adminApi, true);
  });

  it("refuses Daraja callbacks from outside Safaricom's addresses when they're set", async () => {
    const strict = await boot({ DARAJA_CALLBACK_IPS: "196.201.214.200" });
    try {
      const res = await strict.api.inject({ method: "POST", url: `/callbacks/daraja/stk/${strict.app.cfg.callbackToken}`, payload: {} });
      assert.equal(res.statusCode, 404);
      const ok = await strict.api.inject({ method: "POST", url: `/callbacks/daraja/stk/${strict.app.cfg.callbackToken}`, payload: {}, remoteAddress: "196.201.214.200" });
      assert.equal(ok.statusCode, 200);
    } finally {
      await stop(strict);
    }
  });
});

describe("webhook addresses", () => {
  it("treats private, metadata and IPv4-in-IPv6 addresses as private", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "100.64.1.1", "192.168.1.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0.0.0.0", "224.0.0.1"])
      assert.equal(privateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "41.90.64.7", "2c0f:fe38::1"]) assert.equal(privateAddress(ip), false, ip);
  });

  it("refuses at connect time when a saved name now points inside", async () => {
    const strict = await boot({ ALLOW_PRIVATE_WEBHOOKS: "false" });
    try {
      const m = await merchant(strict);
      // Saved while it looked public, then the name moved: written straight to the table.
      await strict.app.db.query(`insert into webhook_endpoints (id, merchant_id, mode, url, events, secret_enc) values ('we_rebind', $1, 'test', 'https://localhost:9/hook', '{payment.succeeded}', $2)`, [
        m.merchantId,
        (await import("../src/lib.js")).seal(strict.app.cfg.masterKey, "whsec_x"),
      ]);
      const r = (await m.dash("POST", "/app/webhooks/we_rebind/test")).json() as { ok: boolean; error: string };
      assert.equal(r.ok, false);
      assert.match(r.error, /private/i);
    } finally {
      await stop(strict);
    }
  });
});

describe("two-step verification", () => {
  it("turns on with an authenticator code, then guards sign-in with it or a recovery code", async () => {
    const m = await merchant(c);
    const tf = await enableTwoFactor(c, m);
    assert.equal(tf.recovery_codes.length, 10);
    assert.equal((await m.dash("GET", "/app/me")).json().user.two_factor, true);

    const first = await signIn(m.email);
    assert.equal(first.json().otp_required, true);
    assert.equal(first.json().method, "totp");
    const pending = as(cookieOf(first));
    assert.equal((await pending("GET", "/app/me")).statusCode, 401, "half signed in reaches nothing");
    assert.equal((await pending("POST", "/app/auth/login/verify", { code: "000000" })).json().error.code, "wrong_code");
    const ok = await pending("POST", "/app/auth/login/verify", { code: await tf.code() });
    assert.equal(ok.statusCode, 200, ok.body);

    // Each recovery code works once.
    const second = as(cookieOf(await signIn(m.email)));
    assert.equal((await second("POST", "/app/auth/login/verify", { code: tf.recovery_codes[0] })).statusCode, 200);
    const third = as(cookieOf(await signIn(m.email)));
    assert.equal((await third("POST", "/app/auth/login/verify", { code: tf.recovery_codes[0] })).json().error.code, "wrong_code");

    // The same authenticator code can't be used twice.
    const code = await tf.code();
    assert.equal((await as(cookieOf(await signIn(m.email)))("POST", "/app/auth/login/verify", { code })).statusCode, 200);
    assert.equal((await as(cookieOf(await signIn(m.email)))("POST", "/app/auth/login/verify", { code })).json().error.code, "code_used");

    // Turning it off needs the password and a code.
    assert.equal((await m.dash("POST", "/app/security/2fa/disable", { password: "nope-nope-nope", code: await tf.code() })).json().error.code, "wrong_password");
    assert.equal((await m.dash("POST", "/app/security/2fa/disable", { password: "correct-horse-battery", code: await tf.code() })).statusCode, 200);
    assert.equal((await signIn(m.email)).json().otp_required, false);
  });

  it("locks after five wrong codes", async () => {
    const m = await merchant(c);
    const tf = await enableTwoFactor(c, m);
    const s = as(cookieOf(await signIn(m.email)));
    for (let i = 0; i < 5; i++) await s("POST", "/app/auth/login/verify", { code: "111111" });
    assert.equal((await s("POST", "/app/auth/login/verify", { code: await tf.code() })).statusCode, 429);
  });

  it("is required before live money leaves when SMS codes are off", async () => {
    const m = await merchant(c);
    await goLive(m);
    const action = { action: "withdraw", mode: "live", amount: 500 };
    assert.equal((await m.dash("POST", "/app/confirmations", action)).json().error.code, "two_factor_required");
    assert.equal((await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500 })).json().error.code, "two_factor_required");
    const tf = await enableTwoFactor(c, m);
    assert.deepEqual((await m.dash("POST", "/app/confirmations", action)).json(), { required: true, method: "totp" });
    assert.equal((await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500 })).json().error.code, "code_required");
    const sent = await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500, code: await tf.code() });
    assert.equal(sent.statusCode, 201, sent.body);
    assert.equal(sent.json().phone, m.phone, "withdrawals go to the owner's number");
  });
});

describe("sessions and passwords", () => {
  it("lists sessions, ends others, and a password change signs out other devices", async () => {
    const m = await merchant(c);
    const other = cookieOf(await signIn(m.email));
    const list = (await m.dash("GET", "/app/security")).json().sessions as { id: string; current: boolean }[];
    assert.equal(list.length, 2);
    assert.equal(list.filter((s) => s.current).length, 1);
    await m.dash("POST", "/app/security/sessions/sign-out-others");
    assert.equal((await as(other)("GET", "/app/me")).statusCode, 401);

    const again = cookieOf(await signIn(m.email));
    assert.equal((await m.dash("POST", "/app/security/password", { current_password: "wrong-password-1", new_password: "a-new-strong-pass-2" })).json().error.code, "wrong_password");
    assert.equal((await m.dash("POST", "/app/security/password", { current_password: "correct-horse-battery", new_password: "password123" })).json().error.code, "weak_password");
    assert.equal((await m.dash("POST", "/app/security/password", { current_password: "correct-horse-battery", new_password: "a-new-strong-pass-2" })).statusCode, 200);
    assert.equal((await as(again)("GET", "/app/me")).statusCode, 401, "the other device is signed out");
    assert.equal((await m.dash("GET", "/app/me")).statusCode, 200, "this one stays");
    const kinds = ((await m.dash("GET", "/app/activity")).json() as { kind: string }[]).map((e) => e.kind);
    assert.ok(kinds.includes("password_changed") && kinds.includes("sessions_ended") && kinds.includes("signed_in"));
  });
});

describe("team", () => {
  it("invites by link, limits each role, and removing someone signs them out", async () => {
    const owner = await merchant(c);
    const inv = await owner.dash("POST", "/app/team/invites", { email: "dev@example.com", role: "developer" });
    assert.equal(inv.statusCode, 201, inv.body);
    const token = new URL(inv.json().invite_url).searchParams.get("token")!;
    const seen = (await c.api.inject({ method: "POST", url: "/app/auth/invite/describe", payload: { token } })).json();
    assert.equal(seen.role, "developer");
    const joined = await c.api.inject({ method: "POST", url: "/app/auth/invite/accept", payload: { token, first_name: "Dee", last_name: "Vee", phone: "0722000111", password: "dev-strong-pass-9" } });
    assert.equal(joined.statusCode, 201, joined.body);
    const dev = as(cookieOf(joined));
    assert.deepEqual((await dev("GET", "/app/me")).json().permissions, ["developers"]);
    assert.equal((await dev("GET", "/app/keys")).statusCode, 200);
    assert.equal((await dev("POST", "/app/wallet/withdraw", { mode: "test", amount: 100 })).json().error.code, "role_forbidden");
    assert.equal((await dev("PATCH", "/app/merchant", { name: "Hijacked" })).json().error.code, "role_forbidden");
    assert.equal((await dev("POST", "/app/team/invites", { email: "x@example.com", role: "admin" })).json().error.code, "role_forbidden");
    // The link works once.
    assert.equal((await c.api.inject({ method: "POST", url: "/app/auth/invite/describe", payload: { token } })).statusCode, 404);

    const team = (await owner.dash("GET", "/app/team")).json() as { members: { id: string; role: string }[] };
    const devId = team.members.find((x) => x.role === "developer")!.id;
    assert.equal((await owner.dash("PATCH", `/app/team/members/${devId}`, { role: "support" })).statusCode, 200);
    assert.equal((await dev("GET", "/app/keys")).json().error.code, "role_forbidden", "support can't see secrets");
    assert.equal((await dev("GET", "/app/payments?mode=test")).statusCode, 200, "but can read payments");
    assert.equal((await owner.dash("DELETE", `/app/team/members/${devId}`)).statusCode, 200);
    assert.equal((await dev("GET", "/app/me")).statusCode, 401);
    assert.equal((await signIn("dev@example.com", "dev-strong-pass-9")).statusCode, 401);
  });

  it("won't invite an email that has its own account", async () => {
    const a = await merchant(c);
    const b = await merchant(c);
    assert.equal((await a.dash("POST", "/app/team/invites", { email: b.email, role: "admin" })).json().error.code, "email_taken");
  });
});

describe("payment links", () => {
  it("takes payments from a public page and caps prompts per phone", async () => {
    const m = await merchant(c);
    assert.equal((await m.dash("POST", "/app/links", { title: "Maize flour 2kg" })).json().error.code, "account_not_live");
    await goLive(m);
    const link = (await m.dash("POST", "/app/links", { title: "Maize flour 2kg", amount: 250, description: "Delivered in Nairobi" })).json();
    assert.match(link.url, /\/pay\/[a-z0-9]{8}$/);
    const view = await c.api.inject({ method: "GET", url: `/pay/links/${link.slug}` });
    assert.equal(view.json().business, "Amina Otieno");
    assert.equal(view.json().amount, 250);
    assert.ok(view.headers["x-ratelimit-remaining"]);

    resetLimits();
    const pay = (phone: string) => c.api.inject({ method: "POST", url: `/pay/links/${link.slug}`, payload: { phone, amount: 1 } });
    const first = await pay("0712000001");
    assert.equal(first.statusCode, 201, first.body);
    const done = await waitFor(async () => {
      const s = (await c.api.inject({ method: "GET", url: `/pay/status/${first.json().payment}` })).json();
      return s.status !== "pending" ? s : null;
    });
    assert.equal(done.status, "succeeded");
    assert.equal(done.amount, 250, "a fixed-price link ignores the amount sent");
    const stats = (await m.dash("GET", `/app/links/${link.id}`)).json();
    assert.equal(stats.paid_count, 1);
    assert.equal(stats.paid_total, 250);

    await pay("0712000001");
    await pay("0712000001");
    assert.equal((await pay("0712000001")).statusCode, 429, "a fourth prompt to one phone in ten minutes is refused");

    await m.dash("PATCH", `/app/links/${link.id}`, { active: false });
    assert.equal((await pay("0712000002")).statusCode, 410);
    assert.equal((await c.api.inject({ method: "GET", url: `/pay/links/${link.slug}` })).json().open, false);
  });
});

describe("refunds, limits and exports", () => {
  it("refunds a payment in parts, never more than was paid", async () => {
    const m = await merchant(c);
    const p = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 1000, reference: "ORDER-9" })).json();
    await waitFor(async () => ((await m.api("GET", `/v1/stk-push/${p.id}`)).json().status === "succeeded" ? true : null));
    const r1 = await m.api("POST", `/v1/payments/${p.id}/refunds`, { amount: 400 });
    assert.equal(r1.statusCode, 201, r1.body);
    assert.equal(r1.json().refund_of, p.id);
    assert.equal(r1.json().phone, "254712345678");
    assert.equal((await m.api("POST", `/v1/payments/${p.id}/refunds`, { amount: 700 })).json().error.code, "refund_exceeds_payment");
    assert.equal((await m.api("POST", `/v1/payments/${p.id}/refunds`, {})).statusCode, 201, "the rest");
    assert.equal((await m.api("GET", `/v1/payments/${p.id}/refunds`)).json().data.length, 2);
  });

  it("holds live payouts to the daily limit", async () => {
    const m = await merchant(c);
    await goLive(m);
    await admin("PATCH", `/admin/merchants/${m.merchantId}/terms`, { payout_daily_limit: 1500 });
    const row = (await c.app.db.query(`select * from merchants where id = $1`, [m.merchantId])).rows[0] as never;
    await createPayout(c.app, row, "live", { phone: "254711111111", amount: 1000, reference: "A", reason: "salary" });
    await assert.rejects(createPayout(c.app, row, "live", { phone: "254711111111", amount: 600, reference: "B", reason: "salary" }), /daily payout limit/);
  });

  it("exports payments as CSV with formulas neutralised", async () => {
    const m = await merchant(c);
    await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 50, reference: "=CMD(1)" });
    const res = await m.dash("GET", "/app/exports/payments?mode=test");
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /text\/csv/);
    assert.match(String(res.headers["content-disposition"]), /attachment; filename="swiftpal-payments-/);
    assert.match(res.body, /'=CMD\(1\)/);
  });
});

describe("console controls", () => {
  it("prices a merchant on their own terms", async () => {
    const m = await merchant(c);
    await admin("PATCH", `/admin/merchants/${m.merchantId}/terms`, { stk_fee: 1.5 });
    await c.app.db.query(`update merchants set live_enabled = true where id = $1`, [m.merchantId]);
    const p = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 500, reference: "X" })).json();
    assert.equal(p.fee.amount, 1.5);
    const detail = (await admin("GET", `/admin/merchants/${m.merchantId}`)).json();
    assert.equal(detail.terms.stk_fee, 1.5);
    const audit = (await admin("GET", "/admin/audit")).json() as { action: string }[];
    assert.ok(audit.some((a) => a.action === "merchant.terms_changed"));
  });

  it("pauses payouts, payments and sign-ups for everyone, and shows a notice", async () => {
    const m = await merchant(c);
    await goLive(m);
    await admin("PATCH", "/admin/platform", { payouts_paused: true, payments_paused: true, signups_paused: true, announcement: { text: "M-Pesa maintenance tonight 11pm to 1am.", tone: "warning" } });
    try {
      forgetSettings();
      const row = (await c.app.db.query(`select * from merchants where id = $1`, [m.merchantId])).rows[0] as never;
      await assert.rejects(createPayout(c.app, row, "live", { phone: "254711111111", amount: 100, reference: "A", reason: "salary" }), /paused/);
      assert.equal((await m.dash("POST", "/app/payments", { mode: "live", phone: "0712345678", amount: 50, reference: "R" })).json().error.code, "payments_paused");
      assert.equal((await c.api.inject({ method: "POST", url: "/app/auth/signup", payload: { first_name: "A", last_name: "B", email: "p@example.com", phone: "0711999888", password: "correct-horse-battery" } })).statusCode, 503);
      assert.equal((await m.dash("GET", "/app/me")).json().announcement.tone, "warning");
      assert.equal((await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 50, reference: "T" })).statusCode, 201, "test mode keeps working");
    } finally {
      await admin("PATCH", "/admin/platform", { payouts_paused: false, payments_paused: false, signups_paused: false, announcement: null });
      forgetSettings();
    }
  });

  it("keeps notes, signs a merchant out everywhere, and resets a member's two-step", async () => {
    const m = await merchant(c);
    await enableTwoFactor(c, m);
    assert.equal((await admin("POST", `/admin/merchants/${m.merchantId}/notes`, { body: "Called about a missing top-up." })).statusCode, 403, "notes need a person, not the script token");
    const out = (await admin("POST", `/admin/merchants/${m.merchantId}/sign-out`)).json();
    assert.ok(out.sessions >= 1);
    assert.equal((await m.dash("GET", "/app/me")).statusCode, 401);
    const people = (await admin("GET", `/admin/merchants/${m.merchantId}`)).json().people as { id: string; two_factor: boolean }[];
    assert.equal(people[0].two_factor, true);
    await admin("POST", `/admin/merchants/${m.merchantId}/users/${people[0].id}/reset-2fa`);
    assert.equal((await signIn(m.email)).json().otp_required, false);
  });

  it("reports volume, fees and risk", async () => {
    const m = await merchant(c);
    await goLive(m);
    const row = (await c.app.db.query(`select * from merchants where id = $1`, [m.merchantId])).rows[0] as never;
    await createPayout(c.app, row, "live", { phone: "254711111111", amount: 100_000, reference: "BIG", reason: "salary" });
    const risk = (await admin("GET", "/admin/risk")).json();
    assert.ok(risk.large_payouts.some((p: { merchant_id: string }) => p.merchant_id === m.merchantId));
    const rep = (await admin("GET", "/admin/reports")).json();
    assert.ok(rep.series.length >= 30);
    assert.ok(rep.totals.signups >= 1);
    const csv = await admin("GET", "/admin/reports/revenue.csv");
    assert.match(csv.body, /Fees earned \(KES\)/);
  });
});

describe("AI connect", () => {
  it("leaves payouts out unless asked, and shows where the request came from", async () => {
    const m = await merchant(c);
    await approve(m);
    const s = (await c.api.inject({ method: "POST", url: "/connect/start", payload: { client_name: "Cursor" }, remoteAddress: "41.90.64.9" })).json();
    assert.equal((await m.dash("GET", `/app/connect/${s.user_code}`)).json().requested_from, "41.90.64.9");
    assert.equal((await m.dash("POST", `/app/connect/${s.user_code}/approve`, {})).statusCode, 200);
    const keys = (await m.dash("GET", "/app/keys")).json() as { name: string; scopes: string[] }[];
    assert.deepEqual(keys.find((k) => k.name === "Cursor (connected)")!.scopes, ["payments:write", "read"]);
    const s2 = (await c.api.inject({ method: "POST", url: "/connect/start", payload: {} })).json();
    assert.equal((await m.dash("POST", `/app/connect/${s2.user_code}/approve`, { scopes: ["payouts:write", "read"] })).json().error.code, "two_factor_required");
  });
});

// A code from the RFC 6238 test vectors, so the helper's maths is checked too.
it("computes authenticator codes", () => {
  assert.equal(hotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
});
