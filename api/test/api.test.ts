import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { hmacHex } from "../src/lib.js";
import { dispatchQueued } from "../src/services/payouts.js";
import { deliverDue } from "../src/services/webhooks.js";
import { boot, form, JPEG, mailCode, merchant, smsCode, stop, waitFor, type Ctx } from "./helpers.js";

let c: Ctx;
before(async () => {
  c = await boot();
});
after(async () => {
  await stop(c);
});

const balance = async (m: Awaited<ReturnType<typeof merchant>>) =>
  (await m.api("GET", "/v1/balance")).json() as { fee_credit: { available: number; held: number }; payout_float: { available: number; held: number } };

const paymentStatus = (m: Awaited<ReturnType<typeof merchant>>, id: string) => async () => {
  const p = (await m.api("GET", `/v1/stk-push/${id}`)).json() as { status: string };
  return p.status !== "pending" ? p : null;
};

/** Pretends live M-Pesa is configured and the live float is funded, for code checks that run before any money moves. */
async function liveReady(m: Awaited<ReturnType<typeof merchant>>) {
  const before = c.app.mpesa.live;
  c.app.mpesa.live ??= c.app.mpesa.test;
  await c.app.db.query(`update balances set available_cents = 10000000 where merchant_id = $1 and mode = 'live' and account = 'float'`, [m.merchantId]);
  return () => void (c.app.mpesa.live = before);
}

describe("accounts", () => {
  it("signs up, proves the phone by SMS and the email by code, and issues a revealable test key", async () => {
    const email = "amina@example.co.ke";
    const res = await c.api.inject({ method: "POST", url: "/app/auth/signup", payload: { first_name: "Amina", last_name: "Otieno", email, phone: "+254712345670", password: "correct-horse-battery" } });
    assert.equal(res.statusCode, 201);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/);
    const h = { cookie: cookie.split(";")[0], "x-requested-with": "SwiftPal" };
    assert.equal((await c.api.inject({ method: "GET", url: "/app/keys", headers: h })).json().error.code, "phone_unverified");
    assert.equal(c.mails.filter((m) => m.to === email).length, 0, "no email code until the phone is proven");
    const wrongSms = await c.api.inject({ method: "POST", url: "/app/auth/verify-phone", payload: { code: "000000" }, headers: h });
    assert.equal(wrongSms.json().error.code, "wrong_code");
    const phoneOk = await c.api.inject({ method: "POST", url: "/app/auth/verify-phone", payload: { code: smsCode(c, "254712345670") }, headers: h });
    assert.equal(phoneOk.statusCode, 200);
    assert.equal((await c.api.inject({ method: "GET", url: "/app/keys", headers: h })).json().error.code, "email_unverified");
    const wrong = await c.api.inject({ method: "POST", url: "/app/auth/verify-email", payload: { code: "000000" }, headers: h });
    assert.equal(wrong.json().error.code, "wrong_code");
    const ok = await c.api.inject({ method: "POST", url: "/app/auth/verify-email", payload: { code: mailCode(c, email) }, headers: h });
    assert.equal(ok.statusCode, 200);
    const keys = (await c.api.inject({ method: "GET", url: "/app/keys", headers: h })).json();
    assert.equal(keys.length, 1);
    assert.match(keys[0].secret, /^sp_test_[A-Za-z0-9]{32}$/);
    const dup = await c.api.inject({ method: "POST", url: "/app/auth/signup", payload: { first_name: "A", last_name: "B", email, phone: "0712345678", password: "correct-horse-battery" } });
    assert.equal(dup.json().error.code, "email_taken");
    const login = await c.api.inject({ method: "POST", url: "/app/auth/login", payload: { email, password: "nope-nope-nope" } });
    assert.equal(login.statusCode, 401);
  });

  it("resets a password with a one-time link and signs out old sessions", async () => {
    const m = await merchant(c);
    const silent = await c.api.inject({ method: "POST", url: "/app/auth/forgot", payload: { email: "nobody@example.co.ke" } });
    assert.equal(silent.statusCode, 200);
    await c.api.inject({ method: "POST", url: "/app/auth/forgot", payload: { email: m.email } });
    const link = c.mails.filter((x) => x.to === m.email).at(-1)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const res = await c.api.inject({ method: "POST", url: "/app/auth/reset", payload: { token: link, password: "a-brand-new-password" } });
    assert.equal(res.statusCode, 200);
    assert.equal((await m.dash("GET", "/app/me")).statusCode, 401);
    const again = await c.api.inject({ method: "POST", url: "/app/auth/reset", payload: { token: link, password: "another-new-password" } });
    assert.equal(again.json().error.code, "invalid_reset_link");
    const login = await c.api.inject({ method: "POST", url: "/app/auth/login", payload: { email: m.email, password: "a-brand-new-password" } });
    assert.equal(login.json().otp_required, true);
  });

  it("signs in with a password and then the SMS code", async () => {
    const m = await merchant(c);
    const login = await c.api.inject({ method: "POST", url: "/app/auth/login", payload: { email: m.email, password: "correct-horse-battery" } });
    assert.equal(login.json().otp_required, true);
    assert.match(login.json().phone_hint, /^2547\d{2}•••\d{3}$/);
    const pending = String(login.headers["set-cookie"]).split(";")[0];
    const h = { cookie: pending, "x-requested-with": "SwiftPal" };
    assert.equal((await c.api.inject({ method: "GET", url: "/app/me", headers: h })).statusCode, 401, "a password alone opens nothing");
    const wrong = await c.api.inject({ method: "POST", url: "/app/auth/login/verify", payload: { code: "000000" }, headers: h });
    assert.equal(wrong.json().error.code, "wrong_code");
    const ok = await c.api.inject({ method: "POST", url: "/app/auth/login/verify", payload: { code: smsCode(c, m.phone) }, headers: h });
    assert.equal(ok.statusCode, 200);
    const full = String(ok.headers["set-cookie"]).split(";")[0];
    assert.notEqual(full, pending);
    assert.equal((await c.api.inject({ method: "GET", url: "/app/me", headers: { cookie: full } })).statusCode, 200);
    assert.equal((await c.api.inject({ method: "POST", url: "/app/auth/login/verify", payload: { code: "123456" }, headers: h })).json().error.code, "login_expired");
  });

  it("changes the phone only with codes to the old and the new number", async () => {
    const m = await merchant(c);
    await m.dash("PATCH", "/app/me", { phone: "0799999999" });
    const me = (await m.dash("GET", "/app/me")).json() as { user: { phone: string } };
    assert.equal(me.user.phone, m.phone, "PATCH /me can't move the number");
    const start = await m.dash("POST", "/app/me/phone", { phone: "0798765432" });
    assert.equal(start.statusCode, 200);
    const oldCode = smsCode(c, m.phone);
    const newCode = smsCode(c, "254798765432");
    const swapped = await m.dash("POST", "/app/me/phone/confirm", { phone: "0798765432", current_code: newCode, new_code: oldCode });
    assert.equal(swapped.json().error.code, "wrong_code");
    const ok = await m.dash("POST", "/app/me/phone/confirm", { phone: "0798765432", current_code: oldCode, new_code: newCode });
    assert.equal(ok.statusCode, 200);
    assert.equal(((await m.dash("GET", "/app/me")).json() as { user: { phone: string } }).user.phone, "254798765432");
    assert.match(c.mails.filter((x) => x.to === m.email).at(-1)!.subject, /phone number changed/);
  });

  it("counts wrong codes even though the request fails", async () => {
    const m = await merchant(c);
    const restore = await liveReady(m);
    await m.dash("POST", "/app/confirmations", { action: "withdraw", mode: "live", amount: 500 });
    for (let i = 0; i < 5; i++) assert.equal((await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500, code: "000000" })).json().error.code, "wrong_code");
    const right = await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500, code: smsCode(c, m.phone) });
    assert.equal(right.json().error.code, "too_many_attempts");
    restore();
  });

  it("asks for an SMS code before live withdrawals and payouts leave the dashboard", async () => {
    const m = await merchant(c);
    const off = await m.dash("POST", "/app/confirmations", { action: "withdraw", mode: "live", amount: 500 });
    assert.equal(off.json().error.code, "live_not_configured", "no code is sent when the money can't move");
    const sent = c.sms.length;
    const restore = await liveReady(m);
    assert.equal(c.sms.length, sent);
    const none = await m.dash("POST", "/app/wallet/withdraw", { mode: "live", amount: 500 });
    assert.equal(none.json().error.code, "code_required");
    assert.equal((await m.dash("POST", "/app/confirmations", { action: "withdraw", mode: "test", amount: 500 })).json().required, false);
    const unverified = await m.dash("POST", "/app/confirmations", { action: "payout", mode: "live", phone: "0711111111", amount: 900, reference: "R1", reason: "refund" });
    assert.equal(unverified.json().error.code, "payouts_not_enabled");
    await c.app.db.query(`update merchants set verification_status = 'approved' where id = $1`, [m.merchantId]);
    const conf = await m.dash("POST", "/app/confirmations", { action: "payout", mode: "live", phone: "0711111111", amount: 900, reference: "R1", reason: "refund" });
    assert.equal(conf.json().required, true);
    const code = smsCode(c, m.phone);
    assert.match(c.sms.at(-1)!.text, /KES 900 to 254711111111/);
    // The code is bound to that recipient and amount.
    const other = await m.dash("POST", "/app/payouts", { mode: "live", phone: "0722222222", amount: 900, reference: "R1", reason: "refund", code });
    assert.equal(other.json().error.code, "code_mismatch");
    // Test mode needs no code.
    const test = await m.dash("POST", "/app/payouts", { mode: "test", phone: "0722222222", amount: 900, reference: "R1", reason: "refund" });
    assert.equal(test.statusCode, 201);
    restore();
  });

  it("refuses state changes without the CSRF header", async () => {
    const m = await merchant(c);
    const res = await c.api.inject({ method: "POST", url: "/app/sandbox/reset", headers: { cookie: m.cookie } });
    assert.equal(res.json().error.code, "csrf");
  });
});

describe("STK Push", () => {
  it("holds the fee, then charges it when the customer pays", async () => {
    const m = await merchant(c);
    const res = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 1250, reference: "ORD-1" });
    assert.equal(res.statusCode, 201);
    const p = res.json();
    assert.equal(p.status, "pending");
    assert.equal(p.fee.amount, 2.5);
    assert.ok(res.headers["x-request-id"]);
    let b = await balance(m);
    assert.equal(b.fee_credit.available, 9997.5);
    assert.equal(b.fee_credit.held, 2.5);
    const done = (await waitFor(paymentStatus(m, p.id))) as { status: string; mpesa_receipt: string; fee: { charged: boolean } };
    assert.equal(done.status, "succeeded");
    assert.match(done.mpesa_receipt, /^T[A-Z0-9]{9}$/);
    assert.equal(done.fee.charged, true);
    b = await balance(m);
    assert.deepEqual(b.fee_credit, { available: 9997.5, held: 0 });
    const ledger = (await m.dash("GET", "/app/ledger?mode=test")).json();
    assert.equal(ledger[0].kind, "fee");
    assert.equal(ledger[0].amount, -2.5);
  });

  it("releases the fee when the customer cancels", async () => {
    const m = await merchant(c);
    const p = (await m.api("POST", "/v1/stk-push", { phone: "254700000001", amount: 500, reference: "ORD-2" })).json();
    const done = (await waitFor(paymentStatus(m, p.id))) as { status: string; failure_code: string };
    assert.equal(done.status, "cancelled");
    assert.equal(done.failure_code, "1032");
    assert.deepEqual((await balance(m)).fee_credit, { available: 10000, held: 0 });
  });

  it("charges nothing under KES 10", async () => {
    const m = await merchant(c);
    const p = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 5, reference: "TINY" })).json();
    assert.equal(p.fee.amount, 0);
    await waitFor(paymentStatus(m, p.id));
    assert.equal((await balance(m)).fee_credit.available, 10000);
  });

  it("replays an idempotent request and rejects a changed body", async () => {
    const m = await merchant(c);
    const h = { "idempotency-key": "order_8841" };
    const a = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 100, reference: "IDEM" }, h);
    const b = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 100, reference: "IDEM" }, h);
    assert.equal(a.json().id, b.json().id);
    assert.equal(b.headers["idempotent-replayed"], "true");
    const changed = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 101, reference: "IDEM" }, h);
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, "idempotency_conflict");
  });

  it("explains bad input and bad keys in the documented shape", async () => {
    const m = await merchant(c);
    const long = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 100, reference: "THIRTEENCHARS" });
    assert.equal(long.statusCode, 400);
    assert.equal(long.json().error.code, "invalid_reference");
    assert.match(long.json().error.doc_url, /#invalid_reference$/);
    const phone = await m.api("POST", "/v1/stk-push", { phone: "0612345678", amount: 100, reference: "X" });
    assert.equal(phone.json().error.code, "invalid_phone");
    const noKey = await c.api.inject({ method: "POST", url: "/v1/stk-push", payload: {} });
    assert.equal(noKey.statusCode, 401);
    assert.equal(noKey.json().error.type, "authentication_error");
    const basic = await c.api.inject({ method: "GET", url: "/v1/balance", headers: { authorization: `Basic ${Buffer.from(`${m.key}:`).toString("base64")}` } });
    assert.equal(basic.statusCode, 200);
  });

  it("refuses when fee credit is short, unless auto-cover is on", async () => {
    const m = await merchant(c);
    await c.app.db.query(`update balances set available_cents = 100 where merchant_id = $1 and mode = 'test' and account = 'fee'`, [m.merchantId]);
    const refused = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 100, reference: "LOW" });
    assert.equal(refused.statusCode, 402);
    assert.equal(refused.json().error.code, "insufficient_fee_credit");
    await m.dash("PATCH", "/app/merchant", { auto_cover: true });
    const ok = await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 100, reference: "LOW" });
    assert.equal(ok.statusCode, 201);
    await waitFor(paymentStatus(m, ok.json().id));
    const b = await balance(m);
    assert.equal(b.fee_credit.available, 1);
    assert.equal(b.payout_float.available, 100000 - 2.5);
  });

  it("takes the first Daraja callback and ignores later ones", async () => {
    const m = await merchant(c);
    const p = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 300, reference: "CB" })).json();
    const row = (await c.app.db.query<{ checkout_request_id: string }>(`select checkout_request_id from payments where id = $1`, [p.id])).rows[0];
    const body = { Body: { stkCallback: { MerchantRequestID: "x", CheckoutRequestID: row.checkout_request_id, ResultCode: 1032, ResultDesc: "Request cancelled by user" } } };
    const wrong = await c.api.inject({ method: "POST", url: "/callbacks/daraja/stk/not-the-token", payload: body });
    assert.equal(wrong.statusCode, 404);
    const res = await c.api.inject({ method: "POST", url: "/callbacks/daraja/stk/dev-callback-token", payload: body });
    assert.deepEqual(res.json(), { ResultCode: 0, ResultDesc: "Accepted" });
    await new Promise((r) => setTimeout(r, 120)); // the sandbox's own success arrives late
    const final = (await m.api("GET", `/v1/stk-push/${p.id}`)).json();
    assert.equal(final.status, "cancelled");
    assert.equal((await balance(m)).fee_credit.held, 0);
  });
});

describe("B2C", () => {
  it("delivers a payout and charges amount and fee", async () => {
    const m = await merchant(c);
    const res = await m.api("POST", "/v1/payouts", { phone: "0712345678", amount: 3500, reference: "WD-1", reason: "withdrawal" });
    assert.equal(res.statusCode, 201);
    const po = res.json();
    assert.equal(po.fee.amount, 36);
    const done = await waitFor(async () => {
      const x = (await m.api("GET", `/v1/payouts/${po.id}`)).json();
      return x.status === "succeeded" ? x : null;
    });
    assert.ok(done.recipient_name);
    const b = await balance(m);
    assert.deepEqual(b.payout_float, { available: 96500, held: 0 });
    assert.deepEqual(b.fee_credit, { available: 9964, held: 0 });
  });

  it("refunds amount and fee when M-Pesa rejects the payout", async () => {
    const m = await merchant(c);
    const po = (await m.api("POST", "/v1/payouts", { phone: "254700000002", amount: 1500, reference: "WD-2", reason: "refund" })).json();
    await waitFor(async () => (await m.api("GET", `/v1/payouts/${po.id}`)).json().status === "failed");
    const b = await balance(m);
    assert.deepEqual(b.payout_float, { available: 100000, held: 0 });
    assert.deepEqual(b.fee_credit, { available: 10000, held: 0 });
  });

  it("reserves a batch all-or-nothing", async () => {
    const m = await merchant(c);
    const tooBig = await m.api("POST", "/v1/payouts/batches", {
      items: [
        { phone: "0712345678", amount: 90000, reference: "A", reason: "salary" },
        { phone: "0722000104", amount: 20000, reference: "B", reason: "salary" },
      ],
    });
    assert.equal(tooBig.statusCode, 409);
    assert.match(tooBig.json().error.message, /Item 2/);
    assert.deepEqual((await balance(m)).payout_float, { available: 100000, held: 0 });

    const ok = await m.api("POST", "/v1/payouts/batches", {
      reference: "PAYROLL",
      items: [
        { phone: "0712345678", amount: 18500, reference: "EMP-1", reason: "salary" },
        { phone: "0722000104", amount: 21000, reference: "EMP-2", reason: "salary" },
      ],
    });
    assert.equal(ok.statusCode, 201);
    await dispatchQueued(c.app);
    const batch = await waitFor(async () => {
      const x = (await m.api("GET", `/v1/payouts/batches/${ok.json().id}`)).json();
      return x.items.every((i: { status: string }) => i.status === "succeeded") ? x : null;
    });
    assert.equal(batch.items.length, 2);
    assert.equal((await balance(m)).payout_float.available, 100000 - 39500);
  });

  it("needs a verified account for live payouts", async () => {
    const m = await merchant(c);
    const res = await m.dash("POST", "/app/payouts", { mode: "live", phone: "0712345678", amount: 100, reference: "X", reason: "other" });
    assert.ok([403, 503].includes(res.statusCode));
  });
});

describe("webhooks", () => {
  it("signs deliveries and retries failures", async () => {
    const got: { sig: string; body: string }[] = [];
    let fail = false;
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        got.push({ sig: String(req.headers["swiftpal-signature"]), body });
        res.statusCode = fail ? 500 : 200;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      const m = await merchant(c);
      const ep = await m.dash("POST", "/app/webhooks", { url: `http://127.0.0.1:${port}/hook`, events: ["payment.succeeded"], mode: "test" });
      assert.equal(ep.statusCode, 201);
      const secret = ep.json().secret as string;
      const p = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 800, reference: "HOOK" })).json();
      await waitFor(paymentStatus(m, p.id));
      await deliverDue(c.app);
      assert.equal(got.length, 1);
      const parts = Object.fromEntries(got[0].sig.split(",").map((x) => x.split("=")));
      assert.equal(parts.v1, hmacHex(secret, `${parts.t}.${got[0].body}`));
      assert.equal(JSON.parse(got[0].body).type, "payment.succeeded");

      fail = true;
      const p2 = (await m.api("POST", "/v1/stk-push", { phone: "0712345678", amount: 900, reference: "HOOK2" })).json();
      await waitFor(paymentStatus(m, p2.id));
      await deliverDue(c.app);
      const d = (await m.dash("GET", "/app/webhooks/deliveries?mode=test")).json();
      assert.equal(d[0].status, "pending");
      assert.equal(d[0].attempts, 1);
      assert.equal(d[0].last_status, 500);
    } finally {
      srv.close();
    }
  });

  it("refuses private addresses when not in test mode", async () => {
    const strict = await boot({ ALLOW_PRIVATE_WEBHOOKS: "false" });
    try {
      const m = await merchant(strict);
      const res = await m.dash("POST", "/app/webhooks", { url: "https://127.0.0.1/hook", events: ["payment.succeeded"], mode: "test" });
      assert.equal(res.json().error.code, "invalid_url");
    } finally {
      await stop(strict);
    }
  });
});

describe("channels", () => {
  it("requires an account number for a paybill", async () => {
    const m = await merchant(c);
    const res = await m.dash("POST", "/app/channels", { kind: "paybill", shortcode: "247247", display_name: "NJERI HOME" });
    assert.equal(res.json().error.code, "account_number_required");
  });

  it("verifies a till with KES 1, turns on live, adds starter credit and a live key", async () => {
    const m = await merchant(c);
    const ch = (await m.dash("POST", "/app/channels", { kind: "till", shortcode: "5521093", display_name: "Njeri Home Stores" })).json();
    assert.equal(ch.status, "unverified");
    const early = await m.dash("POST", `/app/channels/${ch.id}/confirm`);
    assert.equal(early.json().error.code, "verification_incomplete");
    const v = (await m.dash("POST", `/app/channels/${ch.id}/verify`)).json();
    assert.equal(v.payment.amount, 1);
    await waitFor(async () => (await m.dash("GET", `/app/payments/${v.payment.id}`)).json().status === "succeeded");
    const done = (await m.dash("POST", `/app/channels/${ch.id}/confirm`)).json();
    assert.equal(done.channel.status, "verified");
    assert.match(done.live_key, /^sp_live_/);
    const me = (await m.dash("GET", "/app/me")).json();
    assert.equal(me.merchant.live_enabled, true);
    assert.equal(me.balances.live.fee_credit.available, 50);
  });
});

describe("verification", () => {
  it("takes ID front, back and a selfie, and an admin approves it", async () => {
    const m = await merchant(c);
    const missing = form({ kind: "individual", name: "Amina Otieno", id_number: "31234567" }, { id_front: { name: "front.jpg", type: "image/jpeg", bytes: JPEG } });
    const r1 = await c.api.inject({ method: "POST", url: "/app/verification", payload: missing.body, headers: { "content-type": missing.contentType, cookie: m.cookie, "x-requested-with": "SwiftPal" } });
    assert.equal(r1.json().error.code, "missing_documents");

    const fake = form(
      { kind: "individual", name: "Amina Otieno", id_number: "31234567" },
      {
        id_front: { name: "front.jpg", type: "image/jpeg", bytes: JPEG },
        id_back: { name: "back.jpg", type: "image/jpeg", bytes: JPEG },
        selfie: { name: "selfie.jpg", type: "image/jpeg", bytes: Buffer.from("not really an image, just text pretending") },
      },
    );
    const r2 = await c.api.inject({ method: "POST", url: "/app/verification", payload: fake.body, headers: { "content-type": fake.contentType, cookie: m.cookie, "x-requested-with": "SwiftPal" } });
    assert.equal(r2.json().error.code, "unsupported_file");

    const good = form(
      { kind: "individual", name: "Amina Otieno", id_number: "31234567" },
      {
        id_front: { name: "front.jpg", type: "image/jpeg", bytes: JPEG },
        id_back: { name: "back.jpg", type: "image/jpeg", bytes: JPEG },
        selfie: { name: "selfie.jpg", type: "image/jpeg", bytes: JPEG },
      },
    );
    const r3 = await c.api.inject({ method: "POST", url: "/app/verification", payload: good.body, headers: { "content-type": good.contentType, cookie: m.cookie, "x-requested-with": "SwiftPal" } });
    assert.equal(r3.statusCode, 201);
    assert.equal(r3.json().documents.length, 3);

    const admin = { authorization: "Bearer admin-token-for-tests" };
    const list = (await c.api.inject({ method: "GET", url: "/admin/verifications", headers: admin })).json();
    const mine = list.find((v: { merchant_id: string }) => v.merchant_id === m.merchantId);
    const detail = (await c.api.inject({ method: "GET", url: `/admin/verifications/${mine.id}`, headers: admin })).json();
    assert.equal(detail.id_number, "31234567");
    const file = await c.api.inject({ method: "GET", url: `/admin/files/${detail.documents[0].id}`, headers: admin });
    assert.equal(file.headers["content-type"], "image/jpeg");
    assert.equal((await c.api.inject({ method: "GET", url: "/admin/verifications", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
    await c.api.inject({ method: "POST", url: `/admin/verifications/${mine.id}/approve`, headers: admin });
    assert.equal((await m.dash("GET", "/app/me")).json().merchant.verification_status, "approved");
  });
});

describe("dashboard data", () => {
  it("serves analytics, logs and sample data", async () => {
    const m = await merchant(c);
    await m.api("GET", "/v1/balance");
    await m.dash("POST", "/app/sandbox/seed");
    const a = (await m.dash("GET", "/app/analytics?mode=test&days=30")).json();
    assert.equal(a.series.length, 30);
    assert.ok(a.current.successful > 50);
    assert.ok(a.previous.successful > 20);
    const logs = (await m.dash("GET", "/app/logs?mode=test")).json();
    assert.equal(logs[0].path, "/v1/balance");
    await m.dash("POST", "/app/sandbox/reset");
    assert.equal((await m.dash("GET", "/app/analytics?mode=test&days=30")).json().current.prompts, 0);
  });
});
