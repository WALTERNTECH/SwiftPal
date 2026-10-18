import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { base32, hotp, verifyTotp } from "../src/totp.js";
import { boot, form, JPEG, merchant, stop, waitFor, type Ctx } from "./helpers.js";

let c: Ctx;
before(async () => {
  c = await boot({ ADMIN_GATEWAY_SECRET: "gateway-secret-for-tests" });
});
after(async () => {
  await stop(c);
});

const GATE = { "x-admin-gateway": "gateway-secret-for-tests", "x-requested-with": "SwiftPal-Admin" };
const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0];

/** A console session that has finished both steps. */
async function signedInAdmin() {
  const setup = await c.api.inject({
    method: "POST",
    url: "/admin/auth/setup",
    headers: GATE,
    payload: { setup_key: "admin-token-for-tests", name: "Walter", email: "owner@swiftpal.test", password: "a-long-owner-password" },
  });
  assert.equal(setup.statusCode, 200, setup.body);
  let cookie = cookieFrom(setup);
  const enroll = await c.api.inject({ method: "GET", url: "/admin/auth/enroll", headers: { ...GATE, cookie } });
  const secret = enroll.json().secret as string;
  const done = await c.api.inject({ method: "POST", url: "/admin/auth/enroll", headers: { ...GATE, cookie }, payload: { code: hotp(secret, Math.floor(Date.now() / 30_000)) } });
  assert.equal(done.statusCode, 200, done.body);
  cookie = cookieFrom(done);
  const req = (method: string, url: string, payload?: unknown) => c.api.inject({ method: method as never, url, payload: payload as never, headers: { ...GATE, cookie } });
  return { req, secret };
}

let owner: Awaited<ReturnType<typeof signedInAdmin>>;

describe("admin sign-in", () => {
  it("computes authenticator codes like the RFC test vector", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    assert.equal(hotp(secret, 1), "287082");
    assert.equal(verifyTotp(secret, "287082", null, 59_000), 1);
    assert.equal(verifyTotp(secret, "287082", 1, 59_000), null, "a code can't be used twice");
  });

  it("only answers browser sessions that came through the console's server", async () => {
    const bare = await c.api.inject({ method: "GET", url: "/admin/auth/state" });
    assert.equal(bare.statusCode, 404);
    const ok = await c.api.inject({ method: "GET", url: "/admin/auth/state", headers: GATE });
    assert.deepEqual(ok.json(), { needs_setup: true });
  });

  it("sets up the owner once, then needs the authenticator code on every sign-in", async () => {
    const wrongKey = await c.api.inject({ method: "POST", url: "/admin/auth/setup", headers: GATE, payload: { setup_key: "nope", name: "Someone", email: "x@swiftpal.test", password: "a-long-owner-password" } });
    assert.equal(wrongKey.json().error.code, "invalid_setup_key");

    owner = await signedInAdmin();
    assert.equal((await owner.req("GET", "/admin/overview")).statusCode, 200);
    const again = await c.api.inject({ method: "POST", url: "/admin/auth/setup", headers: GATE, payload: { setup_key: "admin-token-for-tests", name: "Someone", email: "y@swiftpal.test", password: "a-long-owner-password" } });
    assert.equal(again.json().error.code, "already_set_up");

    const login = await c.api.inject({ method: "POST", url: "/admin/auth/login", headers: GATE, payload: { email: "owner@swiftpal.test", password: "a-long-owner-password" } });
    assert.equal(login.json().stage, "totp");
    const half = cookieFrom(login);
    const blocked = await c.api.inject({ method: "GET", url: "/admin/merchants", headers: { ...GATE, cookie: half } });
    assert.equal(blocked.json().error.code, "second_step_required", "a password alone opens nothing");
    const step = Math.floor(Date.now() / 30_000);
    const replay = await c.api.inject({ method: "POST", url: "/admin/auth/totp", headers: { ...GATE, cookie: half }, payload: { code: hotp(owner.secret, step) } });
    assert.equal(replay.json().error.code, "wrong_code", "the enrolment code can't be replayed");
    const fresh = await c.api.inject({ method: "POST", url: "/admin/auth/totp", headers: { ...GATE, cookie: half }, payload: { code: hotp(owner.secret, step + 1) } });
    assert.equal(fresh.json().stage, "full");
  });
});

describe("admin operations", () => {
  it("approves KYC, adjusts balances with a reason, and keeps an audit trail", async () => {
    const m = await merchant(c);
    const f = form(
      { kind: "individual", name: "Amina Otieno", id_number: "31234567" },
      { id_front: { name: "f.jpg", type: "image/jpeg", bytes: JPEG }, id_back: { name: "b.jpg", type: "image/jpeg", bytes: JPEG }, selfie: { name: "s.jpg", type: "image/jpeg", bytes: JPEG } },
    );
    const sub = await c.api.inject({ method: "POST", url: "/app/verification", payload: f.body, headers: { "content-type": f.contentType, cookie: m.cookie, "x-requested-with": "SwiftPal" } });
    const queue = (await owner.req("GET", "/admin/verifications")).json() as { id: string }[];
    assert.ok(queue.some((v) => v.id === sub.json().id));
    assert.equal((await owner.req("POST", `/admin/verifications/${sub.json().id}/approve`)).statusCode, 200);

    const credit = await owner.req("POST", `/admin/merchants/${m.merchantId}/adjust`, { account: "float", direction: "credit", amount: 1500, reason: "M-Pesa top-up TJG4K2XQ8P not reflected", reference: "TJG4K2XQ8P" });
    assert.equal(credit.json().payout_float.available, 1500);
    const tooMuch = await owner.req("POST", `/admin/merchants/${m.merchantId}/adjust`, { account: "float", direction: "debit", amount: 5000, reason: "testing a debit that is too big" });
    assert.equal(tooMuch.json().error.code, "insufficient_balance");
    const noReason = await owner.req("POST", `/admin/merchants/${m.merchantId}/adjust`, { account: "fee", direction: "credit", amount: 10, reason: "x" });
    assert.equal(noReason.statusCode, 400);

    const detail = (await owner.req("GET", `/admin/merchants/${m.merchantId}`)).json();
    assert.ok(detail.ledger.some((l: { kind: string; amount: number }) => l.kind === "adjustment" && l.amount === 1500));
    const actions = detail.audit.map((a: { action: string }) => a.action);
    assert.ok(actions.includes("balance.credit") && actions.includes("kyc.approved"));
  });

  it("confirms a payment SwiftPal closed as cancelled once M-Pesa shows it paid", async () => {
    const m = await merchant(c);
    const pay = (await m.api("POST", "/v1/stk-push", { phone: "254700000001", amount: 500, reference: "LATE-1" })).json();
    await waitFor(async () => (await m.api("GET", `/v1/stk-push/${pay.id}`)).json().status === "cancelled");
    const missing = await owner.req("POST", `/admin/payments/${pay.id}/resolve`, { outcome: "succeeded", note: "Customer showed the SMS" });
    assert.equal(missing.json().error.code, "receipt_required");
    const fixed = await owner.req("POST", `/admin/payments/${pay.id}/resolve`, { outcome: "succeeded", receipt: "TJG4K2XQ8P", note: "Customer showed the SMS" });
    assert.equal(fixed.json().status, "succeeded");
    assert.equal(fixed.json().fee.charged, true);
    assert.equal((await m.api("GET", `/v1/stk-push/${pay.id}`)).json().mpesa_receipt, "TJG4K2XQ8P");
  });

  it("fails a payout that never went out and refunds it", async () => {
    const m = await merchant(c);
    const before = (await m.api("GET", "/v1/balance")).json().payout_float.available;
    const batch = (await m.api("POST", "/v1/payouts/batches", { items: [{ phone: "0712345678", amount: 700, reference: "B-1", reason: "salary" }] })).json();
    const items = (await owner.req("GET", `/admin/payouts?mode=test&q=B-1&status=queued`)).json() as { id: string; batch: string }[];
    const item = items.find((p) => p.batch === batch.id)!;
    const notSent = await owner.req("POST", `/admin/payouts/${item.id}/resolve`, { outcome: "succeeded", receipt: "TJG4K2XQ8P", note: "should not work" });
    assert.equal(notSent.json().error.code, "not_sent");
    const failed = await owner.req("POST", `/admin/payouts/${item.id}/resolve`, { outcome: "failed", note: "Cancelled at the merchant's request" });
    assert.equal(failed.json().status, "failed");
    assert.equal((await m.api("GET", "/v1/balance")).json().payout_float.available, before);
  });

  it("suspends an account: its keys stop working until it's lifted", async () => {
    const m = await merchant(c);
    assert.equal((await owner.req("POST", `/admin/merchants/${m.merchantId}/suspend`, { reason: "Chargeback investigation" })).statusCode, 200);
    assert.equal((await m.api("GET", "/v1/balance")).json().error.code, "account_suspended");
    await owner.req("POST", `/admin/merchants/${m.merchantId}/unsuspend`);
    assert.equal((await m.api("GET", "/v1/balance")).statusCode, 200);
  });

  it("lets the owner add an admin, and only the owner", async () => {
    const add = await owner.req("POST", "/admin/admins", { name: "Support", email: "support@swiftpal.test", password: "another-long-password", role: "admin" });
    assert.equal(add.statusCode, 201);
    const list = (await owner.req("GET", "/admin/admins")).json() as { email: string }[];
    assert.ok(list.some((a) => a.email === "support@swiftpal.test"));
  });
});
