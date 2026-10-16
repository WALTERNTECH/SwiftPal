import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { FeeCalculator } from "@/components/site/FeeCalculator";
import { B2C_BANDS, STARTER_CREDIT, STK_BANDS } from "@/lib/pricing";
import { fee, num } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "KES 2.50 per successful STK Push. B2C payouts from KES 5. No setup or monthly fees.",
};

const range = (min: number, max: number | null) => (max === null ? `${num(min)}+` : `${num(min)} – ${num(max)}`);

export default function Pricing() {
  const stk = STK_BANDS[1].flat!;
  return (
    <>
      <section className="page-head f-sec" style={{ borderTop: 0 }}>
        <div className="eyebrow">Pricing</div>
        <h1>
          Per transaction. <span className="soft">Nothing else.</span>
        </h1>
        <p>Prefund fee credit by M-Pesa. Each completed transaction deducts its fee. No setup fee, no monthly fee.</p>
      </section>

      <section className="f-sec sec" style={{ paddingTop: 48 }}>
        <div className="stack" style={{ gap: 20 }}>
          <div className="price-cards reveal">
            <div className="price-card">
              <div className="spread">
                <h2>STK Push</h2>
                <span className="tag post">COLLECT</span>
              </div>
              <div className="price-big">
                <span className="num">{stk.toFixed(2)}</span>
                <span className="muted">KES per successful payment</span>
              </div>
              <ul>
                <li><Icon name="check" size={14} /> One fee from KES 10 to KES 250,000</li>
                <li><Icon name="check" size={14} /> Free under KES 10</li>
                <li><Icon name="check" size={14} /> Cancelled, expired or failed prompts: no fee</li>
              </ul>
            </div>
            <div className="price-card">
              <div className="spread">
                <h2>B2C payouts</h2>
                <span className="tag get">PAY OUT</span>
              </div>
              <div className="price-big">
                <span className="muted">from</span>
                <span className="num">{B2C_BANDS[0].flat}</span>
                <span className="muted">KES per recipient</span>
              </div>
              <ul>
                <li><Icon name="check" size={14} /> Flat fee per band, no percentages</li>
                <li><Icon name="check" size={14} /> Fee refunded if the payout fails</li>
                <li><Icon name="check" size={14} /> Same rate for bulk and single payouts</li>
              </ul>
            </div>
          </div>
          <div className="reveal" style={{ ["--d" as string]: "80ms" }}>
            <FeeCalculator />
          </div>
        </div>
      </section>

      <section className="f-sec sec">
        <div className="sec-head reveal">
          <div className="eyebrow">Fee schedule</div>
          <h2>
            Every band. <span className="soft">In KES.</span>
          </h2>
        </div>
        <div className="bands">
          <div className="panel table-wrap reveal">
            <table className="table">
              <thead>
                <tr>
                  <th>STK Push amount</th>
                  <th className="right">Fee</th>
                </tr>
              </thead>
              <tbody>
                {STK_BANDS.map((b) => (
                  <tr key={b.min}>
                    <td className="num">{range(b.min, b.max === null ? 250_000 : b.max)}</td>
                    <td className="right num">{fee(b.flat!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel-body muted" style={{ fontSize: 13, borderTop: "1px solid var(--line)" }}>
              Charged when the customer pays. Held while the prompt is open, released if it isn&apos;t paid.
            </div>
          </div>
          <div className="panel table-wrap reveal" style={{ ["--d" as string]: "80ms" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>B2C payout amount</th>
                  <th className="right">Fee</th>
                </tr>
              </thead>
              <tbody>
                {B2C_BANDS.map((b) => (
                  <tr key={b.min}>
                    <td className="num">{range(b.min, b.max)}</td>
                    <td className="right num">{b.percent !== undefined ? `${b.percent}%` : fee(b.flat!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="f-sec sec">
        <div className="dev-grid">
          <div className="reveal">
            <div className="eyebrow">Balances</div>
            <h2 style={{ fontSize: "clamp(28px, 3.6vw, 40px)", letterSpacing: "-0.035em", marginTop: 14 }}>
              Fee credit and payout float.
            </h2>
          </div>
          <div className="stack reveal" style={{ ["--d" as string]: "80ms" }}>
            <div className="panel panel-body">
              <div className="spread">
                <b>Fee credit</b>
                <span className="badge plain">Non-withdrawable</span>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                Pays STK Push and B2C fees. KES {STARTER_CREDIT} is added when your first Till or Paybill is verified.
              </p>
            </div>
            <div className="panel panel-body">
              <div className="spread">
                <b>Payout float</b>
                <span className="badge pine">Withdrawable</span>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                Funds B2C payouts. Failed payouts return to it automatically.
              </p>
            </div>
            <p className="hint">
              Optional auto-cover takes fees from payout float when fee credit runs out. Volume pricing above KES 10M a month:{" "}
              <a className="link" href={`mailto:${SITE.salesEmail}`}>{SITE.salesEmail}</a>.
            </p>
          </div>
        </div>
      </section>

      <section className="f-sec cta">
        <div className="cta-glow" aria-hidden />
        <h2 className="reveal">
          Start in the sandbox. <span className="grad">Pay when it&apos;s live.</span>
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
