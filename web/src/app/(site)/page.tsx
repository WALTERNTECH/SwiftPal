import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Bento } from "@/components/site/Bento";
import { DarajaCompare } from "@/components/site/DarajaCompare";
import { HeroDemo } from "@/components/site/HeroDemo";
import { TypedCode } from "@/components/TypedCode";
import { SITE } from "@/lib/site";
import { STK_RESPONSE, stkSnippets } from "@/lib/snippets";

const STATS = [
  ["0", "Daraja credentials to manage"],
  ["300", "requests / min per key"],
  ["2.50", "KES per successful prompt"],
];

export default function Home() {
  return (
    <>
      <section className="hero f-sec">
        <div className="hero-bg" aria-hidden />
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-chips">
              <span>STK Push</span>
              <i />
              <span>B2C Payouts</span>
              <i />
              <span>Webhooks</span>
            </div>
            <h1 className="hero-title">
              <span className="w" style={{ ["--d" as string]: "0ms" }}>M-Pesa,</span>{" "}
              <span className="w grad" style={{ ["--d" as string]: "120ms" }}>programmable.</span>
            </h1>
            <p className="lede">
              Integrate STK Push and B2C disbursements in minutes. No Daraja configuration. No callback chaos. Just clean APIs
              that work.
            </p>
            <Link href="/signup" className="split-btn lg">
              <span>Start integrating</span>
              <i>
                <Icon name="arrowRight" size={16} />
              </i>
            </Link>
            <dl className="hero-meta">
              <div>
                <dt>Base URL</dt>
                <dd className="mono">{SITE.apiBase.replace("https://", "")}</dd>
              </div>
              <div>
                <dt>Auth</dt>
                <dd className="mono">Bearer sp_live_…</dd>
              </div>
            </dl>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="f-sec sec">
        <div className="sec-head reveal">
          <div className="eyebrow">The problem</div>
          <h2>
            Daraja is a project. <span className="soft">SwiftPal is one request.</span>
          </h2>
        </div>
        <div className="reveal" style={{ ["--d" as string]: "80ms" }}>
          <DarajaCompare />
        </div>
      </section>

      <section className="f-sec sec" id="products">
        <div className="sec-head reveal">
          <div className="eyebrow">Products</div>
          <h2>
            Collect and disburse. <span className="soft">One API surface.</span>
          </h2>
        </div>
        <Bento />
      </section>

      <section className="f-sec sec dev">
        <div className="dev-grid">
          <div className="dev-copy reveal">
            <div className="eyebrow">Developer experience</div>
            <h2>
              One API call. <span className="soft">That&apos;s the integration.</span>
            </h2>
            <p className="muted">
              Send a POST and the customer gets the prompt. Tokens, passwords, callbacks and retries happen on our side.
            </p>
            <dl className="dev-stats">
              {STATS.map(([n, l], i) => (
                <div key={l} className="reveal" style={{ ["--d" as string]: `${120 + i * 80}ms` }}>
                  <dd className="num">{n}</dd>
                  <dt>{l}</dt>
                </div>
              ))}
            </dl>
            <Link href="/docs/quickstart" className="text-link">
              Quickstart <Icon name="arrowRight" size={14} className="arrow" />
            </Link>
          </div>
          <div className="reveal" style={{ ["--d" as string]: "100ms" }}>
            <div className="endpoint-line">
              <span className="tag post">POST</span>
              <span className="mono">/v1/stk-push</span>
            </div>
            <TypedCode tabs={stkSnippets()} response={{ label: "201 Created", code: STK_RESPONSE }} minHeight={300} />
          </div>
        </div>
      </section>

      <section className="f-sec price-band">
        {[
          ["2.50", "KES per successful STK Push", "Free under KES 10. Nothing for cancelled or expired prompts."],
          ["5", "KES per B2C payout, from", "Flat bands up to KES 250,000. Refunded if the payout fails."],
          ["0", "KES setup or monthly", "Prefund fee credit by M-Pesa. Top-ups are free."],
        ].map(([n, l, d], i) => (
          <div key={l} className="price-cell reveal" style={{ ["--d" as string]: `${i * 80}ms` }}>
            <span className="num big">{n}</span>
            <b>{l}</b>
            <p>{d}</p>
          </div>
        ))}
        <Link href="/pricing" className="price-more">
          Full pricing <Icon name="arrowRight" size={14} className="arrow" />
        </Link>
      </section>

      <section className="f-sec cta">
        <div className="cta-glow" aria-hidden />
        <h2 className="reveal">
          Your first STK Push is <span className="grad">one request away.</span>
        </h2>
        <Link href="/signup" className="split-btn lg reveal" style={{ ["--d" as string]: "100ms" }}>
          <span>Start integrating</span>
          <i>
            <Icon name="arrowRight" size={16} />
          </i>
        </Link>
      </section>
    </>
  );
}
