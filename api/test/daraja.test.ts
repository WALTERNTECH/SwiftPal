import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { darajaTimestamp } from "../src/lib.js";
import { parseB2cResult, parseStkCallback } from "../src/mpesa/callbacks.js";
import { DarajaClient } from "../src/mpesa/daraja.js";
import { MpesaRejected } from "../src/mpesa/types.js";

const cfg = { env: "sandbox" as const, consumerKey: "ck", consumerSecret: "cs", b2cShortcode: "600999", initiatorName: "apiop", securityCredential: "ENCRYPTED==" };

function mock(responses: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const path = new URL(url).pathname;
    const r = responses[path](body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("Daraja client", () => {
  it("caches the OAuth token and builds the STK password from shortcode, passkey and Kenyan time", async () => {
    const { calls, fetcher } = mock({
      "/oauth/v1/generate": () => ({ json: { access_token: "tok", expires_in: "3599" } }),
      "/mpesa/stkpush/v1/processrequest": () => ({ json: { MerchantRequestID: "m1", CheckoutRequestID: "ws_CO_1", ResponseCode: "0" } }),
    });
    const d = new DarajaClient(cfg, fetcher);
    const req = {
      businessShortCode: "174379",
      passkey: "pk",
      partyB: "174379",
      transactionType: "CustomerPayBillOnline" as const,
      amount: 1,
      phone: "254708374149",
      accountReference: "ACCOUNT-NUMBER-TOO-LONG",
      description: "Payment for goods",
      callbackUrl: "https://api.example/cb",
    };
    const r1 = await d.stkPush(req);
    await d.stkPush(req);
    assert.deepEqual(r1, { merchantRequestId: "m1", checkoutRequestId: "ws_CO_1" });
    assert.equal(calls.filter((c) => c.url.includes("oauth")).length, 1);
    assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from("ck:cs").toString("base64")}`);
    const sent = calls[1].body as Record<string, string | number>;
    assert.equal(sent.Password, Buffer.from(`174379pk${sent.Timestamp}`).toString("base64"));
    assert.match(String(sent.Timestamp), /^\d{14}$/);
    assert.equal(sent.AccountReference, "ACCOUNT-NUMB"); // M-Pesa caps it at 12
    assert.equal(sent.TransactionDesc, "Payment for g");
    assert.equal(sent.PartyA, "254708374149");
  });

  it("maps a Daraja rejection to MpesaRejected and a pending query to null", async () => {
    const { fetcher } = mock({
      "/oauth/v1/generate": () => ({ json: { access_token: "tok", expires_in: 3599 } }),
      "/mpesa/stkpush/v1/processrequest": () => ({ status: 400, json: { requestId: "r", errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" } }),
      "/mpesa/stkpushquery/v1/query": () => ({ status: 500, json: { requestId: "r", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" } }),
    });
    const d = new DarajaClient(cfg, fetcher);
    await assert.rejects(
      () => d.stkPush({ businessShortCode: "1", passkey: "p", partyB: "1", transactionType: "CustomerBuyGoodsOnline", amount: 1, phone: "2547", accountReference: "x", description: "x", callbackUrl: "u" }),
      (e: unknown) => e instanceof MpesaRejected && e.code === "400.002.02" && /Invalid PhoneNumber/.test(e.message),
    );
    assert.deepEqual(await d.stkQuery({ businessShortCode: "1", passkey: "p", checkoutRequestId: "ws" }), { resultCode: null, resultDesc: "The transaction is being processed" });
  });

  it("sends B2C v3 with the initiator and encrypted credential", async () => {
    const { calls, fetcher } = mock({
      "/oauth/v1/generate": () => ({ json: { access_token: "tok", expires_in: 3599 } }),
      "/mpesa/b2c/v3/paymentrequest": () => ({ json: { ConversationID: "AG_1", OriginatorConversationID: "SP-po_1", ResponseCode: "0" } }),
    });
    const d = new DarajaClient(cfg, fetcher);
    const r = await d.b2c({ originatorConversationId: "SP-po_1", amount: 3500, phone: "254712345678", commandId: "SalaryPayment", remarks: "EMP-1", occasion: "salary", resultUrl: "https://r", timeoutUrl: "https://t" });
    assert.equal(r.conversationId, "AG_1");
    const b = calls[1].body as Record<string, unknown>;
    assert.equal(b.InitiatorName, "apiop");
    assert.equal(b.SecurityCredential, "ENCRYPTED==");
    assert.equal(b.PartyA, "600999");
    assert.equal(b.CommandID, "SalaryPayment");
  });

  it("formats timestamps in Nairobi time", () => {
    assert.equal(darajaTimestamp(new Date("2026-10-17T21:30:05Z")), "20261018003005");
  });
});

describe("callback parsers", () => {
  it("reads Safaricom's STK callback by name, not position", () => {
    const r = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "29115-34620561-1",
          CheckoutRequestID: "ws_CO_191220191020363925",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
              { Name: "Amount", Value: 1.0 },
              { Name: "Balance" },
              { Name: "TransactionDate", Value: 20191219102115 },
              { Name: "PhoneNumber", Value: 254708374149 },
            ],
          },
        },
      },
    });
    assert.deepEqual(r, {
      checkoutRequestId: "ws_CO_191220191020363925",
      merchantRequestId: "29115-34620561-1",
      resultCode: "0",
      resultDesc: "The service request is processed successfully.",
      receipt: "NLJ7RT61SV",
      amount: 1,
      phone: "254708374149",
    });
    assert.equal(parseStkCallback({ nonsense: true }), null);
  });

  it("reads Safaricom's B2C result including the recipient's public name", () => {
    const r = parseB2cResult({
      Result: {
        ResultType: 0,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        OriginatorConversationID: "SP-po_1",
        ConversationID: "AG_20191219_00005797af5d7d75f652",
        TransactionID: "NLJ41HAY6Q",
        ResultParameters: {
          ResultParameter: [
            { Key: "TransactionAmount", Value: 10 },
            { Key: "TransactionReceipt", Value: "NLJ41HAY6Q" },
            { Key: "ReceiverPartyPublicName", Value: "254708374149 - John Doe" },
          ],
        },
      },
    });
    assert.equal(r?.receipt, "NLJ41HAY6Q");
    assert.equal(r?.recipientName, "John Doe");
    assert.equal(r?.amount, 10);
    assert.equal(r?.resultCode, "0");
  });
});
