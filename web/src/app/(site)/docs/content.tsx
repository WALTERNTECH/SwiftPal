import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { B2C_BANDS, STARTER_CREDIT } from "@/lib/pricing";
import { SANDBOX_NUMBERS, SITE } from "@/lib/site";
import { payoutSnippets, STK_RESPONSE, stkSnippets, VERIFY_SNIPPETS, WEBHOOK_EVENT } from "@/lib/snippets";

export type DocPage = { slug: string; title: string; group: string; lede: string; body: () => ReactNode };

const C = ({ children }: { children: ReactNode }) => <code className="inline-code">{children}</code>;

function Endpoint({ method, path }: { method: "GET" | "POST" | "DELETE"; path: string }) {
  return (
    <div className="endpoint">
      <span className={`tag ${method === "GET" ? "get" : "post"}`}>{method}</span>
      <span>{path}</span>
    </div>
  );
}

function Params({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="panel table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, t, d]) => (
            <tr key={f}>
              <td>
                <C>{f}</C>
              </td>
              <td className="mono muted" style={{ fontSize: 12.5 }}>
                {t}
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ERRORS: [number, string, string][] = [
  [400, "invalid_phone", "The phone number is not a Safaricom number in a format we accept. Send 07XXXXXXXX, 01XXXXXXXX or 2547XXXXXXXX."],
  [400, "invalid_amount", "Amount must be a whole number of shillings within the product's range."],
  [400, "reference_too_long", "reference is shown on the customer's statement and M-Pesa caps it at 12 characters."],
  [401, "invalid_api_key", "The key is missing, mistyped or revoked. Check the Authorization header."],
  [403, "key_scope_denied", "The key exists but is not allowed to call this endpoint. Edit its scopes in the dashboard."],
  [403, "ip_not_allowed", "The key has an IP allowlist and this request came from elsewhere."],
  [403, "account_not_live", "A live key was used before the account went live. Use your sp_test_ key until then."],
  [403, "payouts_not_enabled", "B2C needs a verified account. Complete Verification in the dashboard."],
  [402, "insufficient_fee_credit", "Fee credit cannot cover the held fee. Top up, or turn on auto-cover from payout float."],
  [409, "insufficient_float", "Payout float is lower than the payout amount."],
  [409, "idempotency_conflict", "This Idempotency-Key was already used with a different request body."],
  [422, "channel_unverified", "The Till or Paybill has not completed its KES 1 verification."],
  [429, "rate_limited", `More than ${SITE.rateLimitPerMinute} requests a minute on this key. Respect the Retry-After header.`],
  [503, "mpesa_unavailable", "Safaricom is not accepting requests right now. Nothing was charged. Retry with backoff."],
];

const EVENTS: [string, string][] = [
  ["payment.succeeded", "Customer entered their PIN and M-Pesa confirmed. Carries mpesa_receipt."],
  ["payment.failed", "M-Pesa declined, usually insufficient balance or a wrong PIN."],
  ["payment.cancelled", "Customer dismissed the prompt."],
  ["payment.expired", "No response within 60 seconds, or the phone was unreachable."],
  ["payout.succeeded", "Money delivered to the recipient. Carries mpesa_receipt and recipient_name."],
  ["payout.failed", "M-Pesa rejected the payout. Amount and fee are back in your balances."],
  ["payout.reversed", "A completed payout was reversed by Safaricom after the fact."],
  ["wallet.topped_up", "A top-up to fee credit or payout float landed."],
  ["wallet.low_balance", "A balance crossed the alert threshold you set."],
];

const FAQ: [string, string][] = [
  ["Do I need my own Daraja app or shortcode approval?", "No. SwiftPal holds the Daraja integration. You add the Paybill or Till you already use, and prompts pay into it."],
  ["Where do customer payments settle?", "In the Paybill or Till you registered, the same as a payment made from the M-Pesa menu."],
  ["What happens when fee credit runs out?", "Requests return 402 insufficient_fee_credit. Turn on auto-cover to take fees from payout float instead, and set a low-balance alert in the dashboard."],
  ["What do I need to go live?", "For STK Push, a Till or Paybill verified with a KES 1 prompt. For B2C payouts, a verified account: national ID and a selfie holding it for individuals; certificate of incorporation, CR12 and a director's ID for businesses."],
  ["Can I withdraw payout float?", "Yes, to the M-Pesa number on your account, at the normal B2C fee for the amount."],
  ["Is there a sandbox?", "Yes. sp_test_ keys simulate prompts, payouts and webhooks with the same responses as live. See Sandbox for numbers that force each outcome."],
];

export const DOCS: DocPage[] = [
  {
    slug: "",
    group: "Get started",
    title: "Introduction",
    lede: "SwiftPal gives your app two M-Pesa primitives: collect with STK Push and pay out with B2C. One key, one webhook format, one wallet.",
    body: () => (
      <>
        <h2>What you can build</h2>
        <div className="panel table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <td><b>Collect payments</b></td>
                <td>Send a PIN prompt to a customer&apos;s phone. Money settles into your own Paybill or Till.</td>
              </tr>
              <tr>
                <td><b>Pay out</b></td>
                <td>Send to any Safaricom number from your prefunded float, one at a time or in bulk.</td>
              </tr>
              <tr>
                <td><b>React to events</b></td>
                <td>Receive signed webhooks for every state change and verify them in a few lines.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h2>API basics</h2>
        <div className="panel table-wrap">
          <table className="table">
            <tbody>
              <tr><td>Base URL</td><td><C>{SITE.apiBase}</C></td></tr>
              <tr><td>Auth</td><td><C>Authorization: Bearer sp_test_…</C> or <C>sp_live_…</C></td></tr>
              <tr><td>Format</td><td>JSON in, JSON out. Field names are always <C>snake_case</C>.</td></tr>
              <tr><td>Amounts</td><td>Whole Kenyan shillings, as integers.</td></tr>
              <tr><td>Phones</td><td>Any common Kenyan format. We return <C>2547XXXXXXXX</C>.</td></tr>
              <tr><td>Rate limit</td><td>{SITE.rateLimitPerMinute} requests per minute per key</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Responses and errors</h2>
        <p>
          A successful call returns the object itself. A failed call returns an <C>error</C> object with a stable{" "}
          <C>code</C>, a human <C>message</C> and a <C>doc_url</C>. Every response carries an{" "}
          <C>X-Request-Id</C> header. Quote it to support and we can find the exact call.
        </p>
        <CodeBlock
          tabs={[
            {
              label: "402 Payment Required",
              lang: "json",
              code: `{
  "error": {
    "type": "balance_error",
    "code": "insufficient_fee_credit",
    "message": "Fee credit is KES 1.50 and this request needs KES 2.50 held. Top up or enable auto-cover.",
    "doc_url": "https://${SITE.domain}/docs/errors#insufficient_fee_credit"
  }
}`,
            },
          ]}
        />
      </>
    ),
  },
  {
    slug: "quickstart",
    group: "Get started",
    title: "Quickstart",
    lede: "Send a sandbox STK Push and receive its webhook in about five minutes. No real money moves.",
    body: () => (
      <>
        <h2>1. Get your test key</h2>
        <p>
          <Link className="link" href="/signup">Create an account</Link> and open <b>Developers → API keys</b>. Your{" "}
          <C>sp_test_</C> key is ready as soon as you verify your email. Put it in an environment variable. Never put it
          in client-side code.
        </p>
        <CodeBlock tabs={[{ label: ".env", lang: "bash", code: "SWIFTPAL_KEY=sp_test_YOUR_SECRET_KEY" }]} />
        <h2>2. Send a prompt</h2>
        <p>
          In test mode, <C>254700000000</C> always succeeds after about five seconds. See{" "}
          <Link className="link" href="/docs/sandbox">Sandbox</Link> for numbers that fail on purpose.
        </p>
        <CodeBlock tabs={stkSnippets(undefined, "254700000000", 100)} />
        <p>The response comes back straight away with the payment in <C>pending</C>:</p>
        <CodeBlock tabs={[{ label: "201 Created", lang: "json", code: STK_RESPONSE.replace("254712345678", "254700000000").replace('"amount": 1250', '"amount": 100') }]} />
        <h2>3. Receive the result</h2>
        <p>
          Add an endpoint under <b>Developers → Webhooks</b>. When the customer pays, we <C>POST</C> a{" "}
          <C>payment.succeeded</C> event to it. Return any <C>2xx</C> quickly, then do your work.
        </p>
        <CodeBlock tabs={[{ label: "payment.succeeded", lang: "json", code: WEBHOOK_EVENT }]} />
        <div className="callout pine">
          <Icon name="info" size={16} />
          <span>
            No public URL yet? The dashboard shows every event under <b>Developers → Webhooks → Deliveries</b>, and you can
            replay any of them once your endpoint is up.
          </span>
        </div>
        <h2>4. Go live</h2>
        <ol>
          <li>Add your Till or Paybill under <b>Channels</b> and approve the KES 1 verification prompt.</li>
          <li>Top up fee credit. You get KES {STARTER_CREDIT} free when your first channel is verified.</li>
          <li>Swap <C>sp_test_</C> for your <C>sp_live_</C> key. Nothing else in your code changes.</li>
        </ol>
      </>
    ),
  },
  {
    slug: "authentication",
    group: "Get started",
    title: "Authentication",
    lede: "Every request carries a secret key as a Bearer token. There is no Base64 encoding and no trailing colon.",
    body: () => (
      <>
        <CodeBlock tabs={[{ label: "Header", lang: "text", code: "Authorization: Bearer sp_live_YOUR_SECRET_KEY" }]} />
        <h2>Test and live keys</h2>
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Prefix</th><th>Mode</th><th>Money moves?</th></tr></thead>
            <tbody>
              <tr><td><C>sp_test_</C></td><td>Sandbox</td><td>No. Prompts and payouts are simulated.</td></tr>
              <tr><td><C>sp_live_</C></td><td>Live</td><td>Yes. Real M-Pesa prompts and payouts.</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Scopes</h2>
        <p>Give each key only what it needs. A key that can only read balances is harmless if it leaks.</p>
        <Params
          rows={[
            ["payments:write", "scope", "Create STK Push requests"],
            ["payouts:write", "scope", "Create single and bulk payouts"],
            ["read", "scope", "Read payments, payouts, balances and events"],
          ]}
        />
        <h2>IP allowlist and rotation</h2>
        <p>
          Restrict a live key to your server&apos;s IP addresses. To rotate, roll the key in the dashboard. The old key
          keeps working for the grace period you choose (up to 72 hours) while you deploy the new one.
        </p>
      </>
    ),
  },
  {
    slug: "sandbox",
    group: "Get started",
    title: "Sandbox",
    lede: "Test mode behaves like live, with the same endpoints, responses, webhooks and timings, but no money moves.",
    body: () => (
      <>
        <p>
          Use your <C>sp_test_</C> key. Prompts are never sent to a real phone. These numbers force each outcome you need
          to handle:
        </p>
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Phone</th><th>Outcome</th><th>M-Pesa code</th><th>What happens</th></tr></thead>
            <tbody>
              {SANDBOX_NUMBERS.map((n) => (
                <tr key={n.phone}>
                  <td className="num">{n.phone}</td>
                  <td><span className={`badge ${n.outcome === "success" ? "ok" : n.outcome === "cancelled" ? "warn" : "bad"}`}>{n.outcome}</span></td>
                  <td className="num">{n.code}</td>
                  <td>{n.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Any other valid number succeeds. Payouts to the same numbers follow the same rules.</p>
        <h2>Test balances</h2>
        <p>
          Test mode starts with KES 10,000 fee credit and KES 100,000 payout float. Reset them at any time from the
          dashboard. They are separate from your live balances.
        </p>
        <div className="callout">
          <Icon name="info" size={16} />
          <span>
            Want to see a real prompt before going live? Amounts from KES 1 to 9 are free in live mode, so a KES 1 payment
            to your own till costs nothing.
          </span>
        </div>
      </>
    ),
  },
  {
    slug: "stk-push",
    group: "Collect",
    title: "STK Push",
    lede: "Send an M-Pesa PIN prompt to a customer's phone and get the result by webhook.",
    body: () => (
      <>
        <Endpoint method="POST" path="/v1/stk-push" />
        <h2>Request</h2>
        <Params
          rows={[
            ["phone", "string", "Customer's Safaricom number. 07…, 01…, +254… or 254… are all accepted."],
            ["amount", "integer", "KES 1 to 250,000. Amounts under KES 10 are free."],
            ["reference", "string", "Up to 12 characters. Your order ID, returned on every webhook. Paybill channels pay into the account number set on the channel."],
            ["description", "string?", "Up to 13 characters, shown on the prompt. Defaults to your business name."],
            ["channel", "string?", "Channel ID (till_… or paybill_…). Leave it out to use your default channel."],
            ["metadata", "object?", "Up to 20 keys of your own. Returned on every webhook."],
          ]}
        />
        <p>
          Always send an <C>Idempotency-Key</C> header, such as your order ID. If the request is retried, you get the original
          payment back instead of a second prompt.
        </p>
        <CodeBlock tabs={stkSnippets()} />
        <h2>Response</h2>
        <CodeBlock tabs={[{ label: "201 Created", lang: "json", code: STK_RESPONSE }]} />
        <h2>Lifecycle</h2>
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Status</th><th>Meaning</th><th>Fee</th></tr></thead>
            <tbody>
              <tr><td><span className="badge info">pending</span></td><td>Prompt delivered. Waiting for the customer (60s max).</td><td>Held</td></tr>
              <tr><td><span className="badge ok">succeeded</span></td><td>Paid. <C>mpesa_receipt</C> is set. Fulfil the order.</td><td>Charged</td></tr>
              <tr><td><span className="badge bad">failed</span></td><td>Declined by M-Pesa. <C>failure_code</C> explains why.</td><td>Released</td></tr>
              <tr><td><span className="badge warn">cancelled</span></td><td>Customer dismissed the prompt.</td><td>Released</td></tr>
              <tr><td><span className="badge">expired</span></td><td>No answer in time, or the phone was off.</td><td>Released</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Retrieve a payment</h2>
        <Endpoint method="GET" path="/v1/stk-push/{id}" />
        <p>Webhooks are the primary signal. Polling is there as a fallback. Wait 10 seconds between polls.</p>
      </>
    ),
  },
  {
    slug: "payouts",
    group: "Pay out",
    title: "B2C payouts",
    lede: "Send money to any Safaricom number from your payout float. Single or bulk, with the fee refunded if a payout fails.",
    body: () => (
      <>
        <div className="callout warn">
          <Icon name="shield" size={16} />
          <span>Live payouts need a verified account. Test mode works straight away.</span>
        </div>
        <Endpoint method="POST" path="/v1/payouts" />
        <Params
          rows={[
            ["phone", "string", "Recipient's Safaricom number."],
            ["amount", "integer", `KES ${B2C_BANDS[0].min} to 250,000.`],
            ["reference", "string", "Your ID for this payout, up to 32 characters."],
            ["reason", "enum", "salary, withdrawal, refund, commission, promotion or other."],
            ["metadata", "object?", "Returned on every webhook."],
          ]}
        />
        <CodeBlock tabs={payoutSnippets()} />
        <h2>What gets deducted</h2>
        <p>
          The amount comes off payout float and the fee comes off fee credit when we accept the request. If M-Pesa rejects
          the payout, both are returned and you receive <C>payout.failed</C>.
        </p>
        <h2>Bulk payouts</h2>
        <Endpoint method="POST" path="/v1/payouts/batches" />
        <p>
          Send up to 1,000 items in one request. Each item becomes its own payout with its own webhooks. The batch is
          accepted only if your float covers the total, so you never end up half-paid.
        </p>
        <CodeBlock
          tabs={[
            {
              label: "Request body",
              lang: "json",
              code: `{
  "reference": "PAYROLL-2026-10",
  "items": [
    { "phone": "254712345678", "amount": 18500, "reference": "EMP-014", "reason": "salary" },
    { "phone": "254722000104", "amount": 21000, "reference": "EMP-015", "reason": "salary" }
  ]
}`,
            },
          ]}
        />
      </>
    ),
  },
  {
    slug: "webhooks",
    group: "Events",
    title: "Webhooks",
    lede: "One envelope for every event, signed with HMAC-SHA256 and retried for 24 hours.",
    body: () => (
      <>
        <h2>Events</h2>
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Type</th><th>When</th></tr></thead>
            <tbody>
              {EVENTS.map(([t, d]) => (
                <tr key={t}><td><C>{t}</C></td><td>{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>Payload</h2>
        <CodeBlock tabs={[{ label: "payment.succeeded", lang: "json", code: WEBHOOK_EVENT }]} />
        <h2>Verify the signature</h2>
        <p>
          Every delivery has a <C>SwiftPal-Signature</C> header like <C>t=1792140079,v1=5257a8…</C>. Compute an
          HMAC-SHA256 of <C>{"{t}.{raw body}"}</C> with your endpoint secret and compare. Reject anything older than five
          minutes. Verify against the raw bytes, not re-serialised JSON.
        </p>
        <CodeBlock tabs={VERIFY_SNIPPETS} />
        <h2>Delivery and retries</h2>
        <p>
          Return a <C>2xx</C> within 10 seconds. Anything else is retried at 1m, 5m, 30m, 2h, 6h and 15h. After that the event
          is marked failed and you can replay it from the dashboard. The same event can arrive twice, so use <C>id</C> to
          de-duplicate.
        </p>
      </>
    ),
  },
  {
    slug: "wallet",
    group: "Events",
    title: "Wallet & balances",
    lede: "Fee credit pays SwiftPal fees. Payout float funds B2C. Both are prefunded by M-Pesa.",
    body: () => (
      <>
        <Endpoint method="GET" path="/v1/balance" />
        <CodeBlock
          tabs={[
            {
              label: "200 OK",
              lang: "json",
              code: `{
  "fee_credit": { "available": 1847.5, "held": 12.5 },
  "payout_float": { "available": 84200, "held": 3500 },
  "auto_cover": false,
  "currency": "KES"
}`,
            },
          ]}
        />
        <p>
          <C>held</C> is money reserved for requests still in flight. When they finish, it is either charged or returned to{" "}
          <C>available</C>.
        </p>
        <h2>Top up</h2>
        <p>
          From the dashboard, choose a balance and an amount, and approve the prompt on your phone. Top-ups are free and
          land in seconds. You can also pay SwiftPal&apos;s Paybill directly with your account number as the reference.
        </p>
      </>
    ),
  },
  {
    slug: "faq",
    group: "Reference",
    title: "FAQ",
    lede: "Short answers to what teams ask before they integrate.",
    body: () => (
      <div className="faq">
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <Icon name="plus" size={16} />
            </summary>
            <p className="muted">{a}</p>
          </details>
        ))}
      </div>
    ),
  },
  {
    slug: "errors",
    group: "Reference",
    title: "Errors",
    lede: "Every error has a stable code. Branch on code, not on message. Messages are written for humans and may change.",
    body: () => (
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>HTTP</th><th>Code</th><th>What to do</th></tr></thead>
          <tbody>
            {ERRORS.map(([h, c, d]) => (
              <tr key={c} id={c}>
                <td className="num">{h}</td>
                <td><C>{c}</C></td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
];
