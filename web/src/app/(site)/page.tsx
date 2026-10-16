import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { HeroDemo } from "@/components/site/HeroDemo";
import { STARTER_CREDIT } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { WEBHOOK_EVENT } from "@/lib/snippets";

const DIFF: { sign: "-" | "+" | " "; text: string }[] = [
  { sign: "-", text: "const { access_token } = await getToken(CONSUMER_KEY, CONSUMER_SECRET); // expires in 3599s" },
  { sign: "-", text: 'const timestamp = format(new Date(), "yyyyMMddHHmmss");' },
  { sign: "-", text: "const password = btoa(SHORTCODE + PASSKEY + timestamp);" },
  { sign: "-", text: 'await axios.post(`${DARAJA}/mpesa/stkpush/v1/processrequest`, {' },
  { sign: "-", text: '  BusinessShortCode, Password: password, Timestamp: timestamp,' },
  { sign: "-", text: '  TransactionType: "CustomerBuyGoodsOnline", Amount, PartyA, PartyB,' },
  { sign: "-", text: "  PhoneNumber, CallBackURL, AccountReference, TransactionDesc," },
  { sign: "-", text: "}, { headers: { Authorization: `Bearer ${access_token}` } });" },
  { sign: "-", text: "// later: dig Body.stkCallback.CallbackMetadata.Item[] out by index" },
  { sign: "+", text: 'await fetch(`${SWIFTPAL}/stk-push`, { method: "POST", headers,' },
  { sign: "+", text: "  body: JSON.stringify({ phone, amount, reference }) });" },
];

const PRODUCTS = [
  {
    eyebrow: "Collect",
    title: "STK Push",
    body: "Your customer gets the M-Pesa PIN prompt on their phone in about two seconds. The money goes straight into the Paybill or Till you registered. SwiftPal never holds your collections.",
    points: ["Till (Buy Goods) and Paybill with account numbers", "KES 2.50, charged only when the customer pays", "M-Pesa receipt and payer number on every success"],
    href: "/docs/stk-push",
  },
  {
    eyebrow: "Pay out",
    title: "B2C disbursements",
    body: "Send money to any Safaricom number from your prefunded payout balance. Send one payout per request, or upload a CSV of a thousand.",
    points: ["Single and bulk payouts with per-row status", "Fee refunded in full if a payout fails", "Withdraw unused float back to M-Pesa any time"],
    href: "/docs/payouts",
  },
  {
    eyebrow: "Know",
    title: "Signed webhooks",
    body: "You get an event for every change of state, signed with HMAC-SHA256. Failed deliveries are retried with backoff for 24 hours, so nothing gets lost.",
    points: ["payment.succeeded, payout.failed and 7 more", "Replay any delivery from the dashboard", "Timestamped signatures block replayed requests"],
    href: "/docs/webhooks",
  },
];

const DX = [
  { k: "sandbox", title: "A sandbox that behaves like production", body: "Use test numbers to force a success, a cancelled prompt, insufficient funds or a timeout. No real money, and the same responses you will see live." },
  { k: "auth", title: "Bearer keys, scoped and rotatable", body: "Test keys start sp_test_ and live keys start sp_live_. Each key gets its own scopes and an optional IP allowlist, and you can roll a key without downtime." },
  { k: "idempotency", title: "Idempotency on every POST", body: "Send an Idempotency-Key header and retries are safe. The same key returns the same result for 24 hours, so a network blip never sends two prompts." },
  { k: "errors", title: "Errors you can act on", body: "Every error comes with a stable code, a plain-English message and a doc_url that explains the fix. You will never have to decode a Safaricom result code yourself." },
  { k: "limits", title: `${SITE.rateLimitPerMinute} requests a minute`, body: "That limit applies per key, with burst headroom for flash sales. Rate-limit headers on every response tell you exactly how much room is left." },
  { k: "logs", title: "Request logs, kept 30 days", body: "Every API call is stored with its body, its response and the webhooks it triggered, so you can search it when a customer says they paid." },
];

const STEPS = [
  { n: "01", t: "Create an account", d: "Email, phone and a password. No documents to start.", time: "1 min" },
  { n: "02", t: "Build in the sandbox", d: "Test keys appear right away, with simulated prompts and webhooks.", time: "Instant" },
  { n: "03", t: "Verify your Till or Paybill", d: "We send you a KES 1 prompt. Check the business name, then approve it.", time: "30 sec" },
  { n: "04", t: "Go live", d: "Switch to your live key. B2C opens once your business details are approved.", time: "Same day" },
];

const FAQ = [
  {
    q: "Do I need my own Daraja app or shortcode approval?",
    a: "No. SwiftPal holds the Daraja integration. You bring the Paybill or Till you already use to receive money, and we send prompts that pay into it.",
  },
  {
    q: "Where does my customers' money go?",
    a: "Straight into your own Paybill or Till, the same way as if they had paid it from the M-Pesa menu. SwiftPal sends the prompt and reports the result. We never hold your collections.",
  },
  {
    q: "What happens when my fee credit runs out?",
    a: "New requests return 402 insufficient_fee_credit with a clear message. You can turn on auto-cover so fees are taken from your payout float instead. You will also get an email and SMS alert before you reach zero, at a level you choose.",
  },
  {
    q: "What do I need to go live?",
    a: "For STK Push, a verified Till or Paybill. For B2C payouts, your business details (ID and KRA PIN for individuals, a registration certificate for companies). Payouts move money we hold for you, so we have to know who you are.",
  },
  {
    q: "Can I get my payout float back?",
    a: "Yes. You can withdraw it to your M-Pesa number from the dashboard at any time. The normal B2C fee for that amount applies, and nothing else.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">M-Pesa API for Kenyan developers</div>
            <h1>
              M-Pesa,
              <br />
              programmable.
            </h1>
            <p className="lede">
              STK Push collections into your own Paybill or Till, and B2C payouts to any Safaricom number. You skip the Daraja
              application, the token juggling and the callback chaos, and get clean APIs that work.
            </p>
            <div className="row wrap hero-ctas">
              <Link href="/signup" className="btn btn-ink btn-lg">
                Create free account
              </Link>
              <Link href="/docs/quickstart" className="btn btn-line btn-lg">
                Read the quickstart <Icon name="arrowRight" size={15} />
              </Link>
            </div>
            <ul className="hero-proof">
              <li>
                <Icon name="check" size={14} /> Sandbox keys the moment you sign up
              </li>
              <li>
                <Icon name="check" size={14} /> KES {STARTER_CREDIT} starter credit
              </li>
              <li>
                <Icon name="check" size={14} /> No fee when a customer cancels
              </li>
            </ul>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section band">
        <div className="container split">
          <div className="split-copy">
            <div className="eyebrow">What you stop writing</div>
            <h2>Delete the Daraja boilerplate.</h2>
            <p className="muted">
              Going to Daraja directly means an app review, OAuth tokens that expire every hour, a password built from a
              passkey and a timestamp, and a callback you parse by array index. SwiftPal handles all of it for you. Your code
              makes one request.
            </p>
            <dl className="stat-row">
              <div>
                <dt>Daraja secrets to store</dt>
                <dd className="num">0</dd>
              </div>
              <div>
                <dt>Approvals to wait for</dt>
                <dd className="num">0</dd>
              </div>
              <div>
                <dt>Tokens to refresh</dt>
                <dd className="num">0</dd>
              </div>
            </dl>
          </div>
          <div className="code diff">
            <div className="code-head">
              <span className="code-title">pay.ts</span>
              <span className="code-title">
                <span className="diff-del">−9</span> <span className="diff-add">+2</span>
              </span>
            </div>
            <pre>
              {DIFF.map((l, i) => (
                <div key={i} className={`diff-line ${l.sign === "-" ? "del" : l.sign === "+" ? "add" : ""}`}>
                  <span className="diff-sign">{l.sign}</span>
                  {l.text}
                </div>
              ))}
            </pre>
          </div>
        </div>
      </section>

      <section className="section" id="products">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Products</div>
            <h2>Two primitives. One API.</h2>
            <p className="muted">
              Take money in and send money out. Both share the same keys, the same webhook format and the same wallet.
            </p>
          </div>
          <div className="product-grid">
            {PRODUCTS.map((p) => (
              <article key={p.title} className="product">
                <div className="eyebrow">{p.eyebrow}</div>
                <h3>{p.title}</h3>
                <p className="muted">{p.body}</p>
                <ul>
                  {p.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
                <Link href={p.href} className="link">
                  Read the reference →
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">How money moves</div>
            <h2>Your collections never pass through us.</h2>
            <p className="muted">
              STK Push pays your Till or Paybill directly. The only money SwiftPal holds is what you prefund on purpose: fee
              credit, and float for payouts.
            </p>
          </div>
          <div className="flows">
            <div className="flow">
              <div className="flow-label">
                <span className="tag post">COLLECT</span> STK Push
              </div>
              <div className="flow-track">
                <div className="flow-node">
                  <span className="eyebrow">Customer</span>
                  <b>0712 ••• 678</b>
                  <span className="muted">enters M-Pesa PIN</span>
                </div>
                <div className="flow-arrow">
                  <span>KES 1,250</span>
                </div>
                <div className="flow-node strong">
                  <span className="eyebrow">Your Till</span>
                  <b>5521093</b>
                  <span className="muted">receives the full amount</span>
                </div>
              </div>
              <div className="flow-foot">
                <Icon name="webhook" size={14} /> SwiftPal sends the prompt, then signs and delivers <code className="inline-code">payment.succeeded</code>. KES 2.50 is taken from fee credit.
              </div>
            </div>
            <div className="flow">
              <div className="flow-label">
                <span className="tag get">PAY OUT</span> B2C
              </div>
              <div className="flow-track">
                <div className="flow-node strong">
                  <span className="eyebrow">Your payout float</span>
                  <b>KES 84,200</b>
                  <span className="muted">prefunded by M-Pesa</span>
                </div>
                <div className="flow-arrow">
                  <span>KES 3,500</span>
                </div>
                <div className="flow-node">
                  <span className="eyebrow">Recipient</span>
                  <b>0722 ••• 104</b>
                  <span className="muted">gets an M-Pesa SMS</span>
                </div>
              </div>
              <div className="flow-foot">
                <Icon name="refresh" size={14} /> If M-Pesa rejects the payout, both the amount and the KES 36 fee go back to your balances automatically.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Developer experience</div>
            <h2>The details you would have built yourself.</h2>
          </div>
          <div className="dx-grid">
            {DX.map((d) => (
              <div key={d.k} className="dx">
                <h3>{d.title}</h3>
                <p className="muted">{d.body}</p>
              </div>
            ))}
          </div>
          <div className="split webhook-split">
            <div className="split-copy">
              <div className="eyebrow">Webhooks</div>
              <h2>One shape for every event.</h2>
              <p className="muted">
                Every webhook uses the same envelope, whether it is about a payment, a payout or your wallet. Fields are always
                snake_case, and the event type tells you what happened. The <code className="inline-code">SwiftPal-Signature</code> header proves it came from us.
              </p>
              <Link href="/docs/webhooks" className="link">
                Verify a signature in 6 lines →
              </Link>
            </div>
            <CodeBlock tabs={[{ label: "payment.succeeded", lang: "json", code: WEBHOOK_EVENT }]} />
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="container">
          <div className="price-strip">
            <div>
              <div className="eyebrow">Pricing</div>
              <h2>Pay for payments, not prompts.</h2>
              <p className="muted">
                There is no setup fee and no monthly fee. Cancelled, timed-out and failed attempts cost nothing.
              </p>
              <Link href="/pricing" className="btn btn-line" style={{ marginTop: 20 }}>
                See every band <Icon name="arrowRight" size={14} />
              </Link>
            </div>
            <div className="price-figs">
              <div>
                <span className="num big">2.50</span>
                <span className="muted">KES per successful STK Push, any amount from KES 10</span>
              </div>
              <div>
                <span className="num big">5</span>
                <span className="muted">KES per B2C payout to start, banded by amount</span>
              </div>
              <div>
                <span className="num big">0</span>
                <span className="muted">KES to top up, to hold a balance, or for a failed attempt</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Onboarding</div>
            <h2>From sign-up to your first live payment.</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <div className="steps-n num">{s.n}</div>
                <h3>{s.t}</h3>
                <p className="muted">{s.d}</p>
                <span className="badge plain">{s.time}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section band">
        <div className="container faq-wrap">
          <div>
            <div className="eyebrow">Questions</div>
            <h2>Before you integrate.</h2>
            <p className="muted" style={{ marginTop: 12 }}>
              Something else? Email <a className="link" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> and an
              engineer will answer.
            </p>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Icon name="plus" size={16} />
                </summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="container cta-inner">
          <div>
            <h2>Send your first STK Push today.</h2>
            <p>Sandbox keys appear as soon as you sign up. You get KES {STARTER_CREDIT} of live credit when your till is verified.</p>
          </div>
          <div className="row wrap">
            <Link href="/signup" className="btn btn-lg cta-btn">
              Create free account
            </Link>
            <Link href="/docs" className="btn btn-lg cta-ghost">
              Browse the docs
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
