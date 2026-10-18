import type { CodeTab } from "@/components/CodeBlock";
import { SITE } from "./site";

const API = SITE.apiBase;

export function stkSnippets(key = "sp_live_YOUR_SECRET_KEY", phone = "254712345678", amount = 1250): CodeTab[] {
  return [
    {
      label: "cURL",
      lang: "bash",
      code: `curl ${API}/stk-push \\
  -H "Authorization: Bearer ${key}" \\
  -H "Idempotency-Key: order_8841" \\
  -H "Content-Type: application/json" \\
  -d '{ "phone": "${phone}", "amount": ${amount}, "reference": "ORDER-8841" }'`,
    },
    {
      label: "Node.js",
      lang: "js",
      code: `const res = await fetch("${API}/stk-push", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SWIFTPAL_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "order_8841",
  },
  body: JSON.stringify({
    phone: "${phone}",
    amount: ${amount},
    reference: "ORDER-8841",
  }),
});

const payment = await res.json();
// payment.status === "pending" — the prompt is on the customer's phone`,
    },
    {
      label: "Python",
      lang: "python",
      code: `import os, requests

payment = requests.post(
    "${API}/stk-push",
    headers={
        "Authorization": f"Bearer {os.environ['SWIFTPAL_KEY']}",
        "Idempotency-Key": "order_8841",
    },
    json={"phone": "${phone}", "amount": ${amount}, "reference": "ORDER-8841"},
).json()

# payment["status"] == "pending" — the prompt is on the customer's phone`,
    },
    {
      label: "PHP",
      lang: "php",
      code: `$ch = curl_init("${API}/stk-push");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer " . getenv("SWIFTPAL_KEY"),
        "Content-Type: application/json",
        "Idempotency-Key: order_8841",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "phone" => "${phone}",
        "amount" => ${amount},
        "reference" => "ORDER-8841",
    ]),
]);
$payment = json_decode(curl_exec($ch), true);`,
    },
  ];
}

export const STK_RESPONSE = `{
  "id": "pay_01JC8Q2VZ7M4K9",
  "object": "payment",
  "status": "pending",
  "amount": 1250,
  "currency": "KES",
  "phone": "254712345678",
  "reference": "ORDER-8841",
  "channel": "till_5521093",
  "fee": { "amount": 2.5, "charged": false },
  "created_at": "2026-10-16T09:41:07Z"
}`;

export const WEBHOOK_EVENT = `{
  "id": "evt_01JC8Q4D3TBN1W",
  "type": "payment.succeeded",
  "created_at": "2026-10-16T09:41:19Z",
  "data": {
    "id": "pay_01JC8Q2VZ7M4K9",
    "status": "succeeded",
    "amount": 1250,
    "phone": "254712345678",
    "reference": "ORDER-8841",
    "mpesa_receipt": "TJG4K2XQ8P",
    "fee": { "amount": 2.5, "charged": true }
  }
}`;

export function payoutSnippets(key = "sp_live_YOUR_SECRET_KEY"): CodeTab[] {
  return [
    {
      label: "cURL",
      lang: "bash",
      code: `curl ${API}/payouts \\
  -H "Authorization: Bearer ${key}" \\
  -H "Idempotency-Key: wd_20931" \\
  -H "Content-Type: application/json" \\
  -d '{ "phone": "254712345678", "amount": 3500, "reference": "WD-20931", "reason": "withdrawal" }'`,
    },
    {
      label: "Node.js",
      lang: "js",
      code: `const res = await fetch("${API}/payouts", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SWIFTPAL_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "wd_20931",
  },
  body: JSON.stringify({
    phone: "254712345678",
    amount: 3500,
    reference: "WD-20931",
    reason: "withdrawal",
  }),
});`,
    },
    {
      label: "Python",
      lang: "python",
      code: `payout = requests.post(
    "${API}/payouts",
    headers={
        "Authorization": f"Bearer {os.environ['SWIFTPAL_KEY']}",
        "Idempotency-Key": "wd_20931",
    },
    json={
        "phone": "254712345678",
        "amount": 3500,
        "reference": "WD-20931",
        "reason": "withdrawal",
    },
).json()`,
    },
  ];
}

export const VERIFY_SNIPPETS: CodeTab[] = [
  {
    label: "Node.js",
    lang: "js",
    code: `import crypto from "node:crypto";

// Express: app.post("/webhooks/swiftpal", express.raw({ type: "application/json" }), handler)
export function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const signed = \`\${parts.t}.\${rawBody}\`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  return fresh && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}`,
  },
  {
    label: "Python",
    lang: "python",
    code: `import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    signed = f"{parts['t']}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    fresh = abs(time.time() - int(parts["t"])) < 300
    return fresh and hmac.compare_digest(expected, parts["v1"])`,
  },
  {
    label: "PHP",
    lang: "php",
    code: `function verify(string $raw, string $header, string $secret): bool {
    parse_str(str_replace(",", "&", $header), $p);
    $expected = hash_hmac("sha256", $p["t"] . "." . $raw, $secret);
    $fresh = abs(time() - (int) $p["t"]) < 300;
    return $fresh && hash_equals($expected, $p["v1"]);
}`,
  },
];

/**
 * A complete brief for an AI coding assistant: paste it into Cursor, Claude
 * Code or Copilot and it has everything needed to wire SwiftPal in correctly.
 */
export const AI_PROMPT = `Integrate SwiftPal M-Pesa payments into this project.

API base URL: ${API}
Authentication: send "Authorization: Bearer <key>" on every request. Read the key from an environment variable named SWIFTPAL_SECRET_KEY. Use it only on the server; never ship it to a browser or mobile app and never commit it.
Send "Idempotency-Key: <unique id per order or payout>" on every POST so a retry never charges or pays twice.
Amounts are whole Kenyan shillings (integers). Phone numbers: 2547XXXXXXXX or 2541XXXXXXXX (07..., 01... and +254... are accepted too).

1. Collect a payment (M-Pesa STK Push): POST /stk-push
   Body: { "phone": "2547XXXXXXXX", "amount": 100, "reference": "ORDER-123" }
   reference is at most 12 characters. Optional: "description" (at most 13 characters), "metadata" (flat object).
   Returns 201 { "id": "pay_...", "status": "pending", ... } and the customer gets a PIN prompt on their phone.
2. Check a payment: GET /stk-push/{id}
   status is pending, succeeded, failed, cancelled or expired. mpesa_receipt is set when it succeeds.
3. Send money (B2C payout): POST /payouts
   Body: { "phone": "2547XXXXXXXX", "amount": 500, "reference": "PAYOUT-1", "reason": "withdrawal" }
   amount 10 to 250,000. reason is one of salary, withdrawal, refund, commission, promotion, other.
   Check it with GET /payouts/{id}: processing, succeeded, failed or reversed.
4. Balances: GET /balance returns fee_credit and payout_float, each with available and held.

Webhooks (set the URL in the SwiftPal dashboard under Developers > Webhooks):
- SwiftPal POSTs JSON: { "id": "evt_...", "type": "payment.succeeded", "created_at": "...", "livemode": true, "data": { ...the payment or payout } }.
- Types: payment.succeeded, payment.failed, payment.cancelled, payment.expired, payout.succeeded, payout.failed, payout.reversed, wallet.topped_up, wallet.low_balance.
- Verify every request before trusting it. Header "SwiftPal-Signature: t=<unix seconds>,v1=<hex>". Compute HMAC-SHA256 over "<t>.<raw request body>" with the endpoint's signing secret (environment variable SWIFTPAL_WEBHOOK_SECRET), compare with v1 in constant time, and reject if t is more than 5 minutes old. Use the raw body bytes, not re-serialised JSON.
- Reply 2xx quickly, then process. Handle each event id once; SwiftPal retries failed deliveries.
- Mark an order paid only from a verified payment.succeeded webhook or GET /stk-push/{id} returning succeeded, never from anything the browser says.

Errors: non-2xx responses are { "error": { "type", "code", "message", "doc_url" } }. Retry 5xx responses with the same Idempotency-Key; don't retry 4xx.
Docs: ${SITE.url}/docs`;
