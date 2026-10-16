import { Icon } from "@/components/Icon";
import { Spotlight } from "@/components/motion";

// Each cell carries a small looping illustration of the thing it describes.
// They are pure CSS loops (see .bv-* in site.css) so they cost nothing to run.
// .bv centres the illustration in the cell; the inner element lays itself out.

function StkVisual() {
  return (
    <div className="bv" aria-hidden>
      <div className="bv-stk-card">
        <div className="bv-stk-top"><span>M-PESA</span><span>KES 1,250</span></div>
        <div className="bv-stk-pin"><i /><i /><i /><i /></div>
        <div className="bv-stk-ok"><Icon name="check" size={12} strokeWidth={2.4} /> Paid · TJG4K2XQ8P</div>
      </div>
    </div>
  );
}

function PayoutVisual() {
  const rows = [
    ["JK", "0712 ••• 678", "18,500"],
    ["MW", "0722 ••• 104", "21,000"],
    ["BO", "0110 ••• 233", "9,750"],
    ["FC", "0741 ••• 590", "12,000"],
  ];
  return (
    <div className="bv" aria-hidden>
      <div className="bv-po">
        {rows.map(([a, p, amt], i) => (
          <div key={p} className="bv-po-row" style={{ ["--i" as string]: i }}>
            <span className="bv-av">{a}</span>
            <span className="mono">{p}</span>
            <span className="mono amt">{amt}</span>
            <span className="bv-st">
              <em>queued</em>
              <b>sent</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HookVisual() {
  return (
    <div className="bv" aria-hidden>
      <div className="bv-hook">
        <span className="bv-node">swiftpal</span>
        <div className="bv-wire">
          <span className="bv-chip ok" style={{ ["--i" as string]: 0 }}>payment.succeeded</span>
          <span className="bv-chip warn" style={{ ["--i" as string]: 1 }}>payment.cancelled</span>
          <span className="bv-chip ok" style={{ ["--i" as string]: 2 }}>payout.succeeded</span>
        </div>
        <span className="bv-node you">your app · 200</span>
      </div>
    </div>
  );
}

function ApiVisual() {
  const rows = [
    ["POST", "/v1/stk-push", "201", "184ms"],
    ["POST", "/v1/payouts", "201", "162ms"],
    ["GET", "/v1/balance", "200", "21ms"],
    ["GET", "/v1/stk-push/pay_01JC8Q2V", "200", "18ms"],
  ];
  return (
    <div className="bv" aria-hidden>
      <div className="bv-api">
        <div className="bv-api-scan" />
        {rows.map(([m, p, s, ms]) => (
          <div key={p} className="bv-api-row">
            <span className={`tag ${m === "GET" ? "get" : "post"}`}>{m}</span>
            <span className="mono p">{p}</span>
            <span className="mono s">{s}</span>
            <span className="mono ms">{ms}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SandboxVisual() {
  const rows = [
    ["254700000000", "succeeded", "ok"],
    ["254700000001", "cancelled", "warn"],
    ["254700000002", "no funds", "bad"],
    ["254700000003", "expired", ""],
  ];
  return (
    <div className="bv" aria-hidden>
      <div className="bv-sb">
        <div className="bv-sb-hl" />
        {rows.map(([p, o, c]) => (
          <div key={p} className="bv-sb-row">
            <span className="mono">{p}</span>
            <span className={`badge ${c}`}>{o}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignVisual() {
  return (
    <div className="bv" aria-hidden>
      <div className="bv-sig">
        <div className="bv-sig-h">
          <span className="dim">SwiftPal-Signature:</span>
          <span className="mono">t=1792140079,</span>
          <span className="mono">v1=5257a8c1e9…f04d</span>
          <span className="bv-sig-sweep" />
        </div>
        <div className="bv-sig-ok">
          <Icon name="shield" size={14} /> HMAC-SHA256 verified
        </div>
      </div>
    </div>
  );
}

const CELLS = [
  { t: "STK Push", d: "Prompt the customer's phone with one call.", v: <StkVisual />, wide: true },
  { t: "B2C payouts", d: "Pay one number or a thousand from your float.", v: <PayoutVisual /> },
  { t: "Webhooks", d: "An event the moment a payment settles.", v: <HookVisual /> },
  { t: "REST API", d: "JSON in, JSON out. One shape everywhere.", v: <ApiVisual />, wide: true },
  { t: "Sandbox", d: "Force success, cancel, timeout or no funds.", v: <SandboxVisual /> },
  { t: "Signed events", d: "HMAC on every delivery. Verify in six lines.", v: <SignVisual />, wide: true },
];

export function Bento() {
  return (
    <Spotlight className="bento">
      {CELLS.map((c, i) => (
        <article key={c.t} data-spot className={`bento-cell reveal ${c.wide ? "wide" : ""}`} style={{ ["--d" as string]: `${(i % 3) * 80}ms` }}>
          {c.v}
          <div className="bento-text">
            <h3>{c.t}</h3>
            <p>{c.d}</p>
          </div>
        </article>
      ))}
    </Spotlight>
  );
}
