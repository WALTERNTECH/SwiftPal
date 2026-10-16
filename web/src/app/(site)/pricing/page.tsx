import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { FeeCalculator } from "@/components/site/FeeCalculator";
import { B2C_BANDS, MARKET_B2C_BANDS, MARKET_B2C_TOP_PERCENT, MARKET_STK_FEE, STARTER_CREDIT, STK_BANDS } from "@/lib/pricing";
import { fee, num } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "KES 2.50 per successful STK Push. B2C payouts from KES 5. No setup or monthly fees, and nothing for failed attempts.",
};

const range = (min: number, max: number | null) => (max === null ? `KES ${num(min)}+` : `KES ${num(min)} – ${num(max)}`);

export default function Pricing() {
  const stk = STK_BANDS[1].flat!;
  return (
    <>
      <section className="page-head">
        <div className="container">
          <div className="eyebrow">Pricing</div>
          <h1>Pay for payments, not prompts.</h1>
          <p>
            You prefund a fee balance, and each completed transaction takes its fee from it. There is no setup fee and no
            monthly fee, and you never pay for a prompt the customer ignored.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 48 }}>
        <div className="container stack" style={{ gap: 20 }}>
          <div className="price-cards">
            <div className="panel price-card">
              <div className="spread">
                <h2>STK Push</h2>
                <span className="tag post">COLLECT</span>
              </div>
              <div className="price-big">
                <span className="num">{stk.toFixed(2)}</span>
                <span className="muted">KES per successful payment</span>
              </div>
              <ul>
                <li><Icon name="check" size={14} /> Same fee for KES 10 or KES 250,000</li>
                <li><Icon name="check" size={14} /> Free under KES 10, which is handy for KES 1 test payments</li>
                <li><Icon name="check" size={14} /> Cancelled, timed-out or failed prompts cost nothing</li>
                <li><Icon name="check" size={14} /> Money settles straight to your own Till or Paybill</li>
              </ul>
            </div>
            <div className="panel price-card">
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
                <li><Icon name="check" size={14} /> A flat fee for each band, with no percentages even at KES 250,000</li>
                <li><Icon name="check" size={14} /> Fee refunded in full if M-Pesa rejects the payout</li>
                <li><Icon name="check" size={14} /> Bulk payouts cost the same per recipient</li>
                <li><Icon name="check" size={14} /> Withdraw unused float any time at the same rates</li>
              </ul>
            </div>
          </div>

          <FeeCalculator />
        </div>
      </section>

      <section className="section band">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Fee schedule</div>
            <h2>Every band, in one table.</h2>
            <p className="muted">
              The comparison column shows the published rates of a leading Kenyan M-Pesa API aggregator, checked October 2026.
              They charge on initiation. SwiftPal charges only when the transaction completes.
            </p>
          </div>

          <div className="panel table-wrap" style={{ marginBottom: 24 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>STK Push amount</th>
                  <th className="right">SwiftPal</th>
                  <th className="right">Typical aggregator</th>
                  <th className="right">You save</th>
                </tr>
              </thead>
              <tbody>
                {STK_BANDS.map((b) => (
                  <tr key={b.min}>
                    <td className="num">{range(b.min, b.max)}</td>
                    <td className="right num">{fee(b.flat!)}</td>
                    <td className="right num muted">{b.flat === 0 ? "Free" : `KES ${MARKET_STK_FEE}`}</td>
                    <td className="right num save">{b.flat === 0 ? "—" : `KES ${(MARKET_STK_FEE - b.flat!).toFixed(2)} + failed attempts`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>B2C payout amount</th>
                  <th className="right">SwiftPal</th>
                  <th className="right">Typical aggregator</th>
                  <th className="right">You save</th>
                </tr>
              </thead>
              <tbody>
                {B2C_BANDS.map((b, i) => {
                  const ours = b.percent !== undefined ? `${b.percent}%` : fee(b.flat!);
                  const theirs = b.percent !== undefined ? `${MARKET_B2C_TOP_PERCENT}%` : `KES ${MARKET_B2C_BANDS[i]}`;
                  const save =
                    b.percent !== undefined
                      ? `${(MARKET_B2C_TOP_PERCENT - b.percent).toFixed(1)} pts`
                      : `KES ${MARKET_B2C_BANDS[i] - b.flat!}`;
                  return (
                    <tr key={b.min}>
                      <td className="num">{range(b.min, b.max)}</td>
                      <td className="right num">{ours}</td>
                      <td className="right num muted">{theirs}</td>
                      <td className="right num save">{save}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split" style={{ alignItems: "start" }}>
          <div className="split-copy">
            <div className="eyebrow">Your balances</div>
            <h2>Two balances. You can always see both.</h2>
            <p className="muted">
              Both balances are prefunded by M-Pesa from the dashboard, and top-ups are free. Every deduction in the ledger
              links to the transaction that caused it.
            </p>
          </div>
          <div className="stack">
            <div className="panel panel-body">
              <div className="spread">
                <b>Fee credit</b>
                <span className="badge plain">Non-withdrawable</span>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                Pays SwiftPal fees for STK Push and B2C. The fee is held when you make a request. It is charged only when the
                transaction completes and released if it does not. New accounts get KES {STARTER_CREDIT} once their till is verified.
              </p>
            </div>
            <div className="panel panel-body">
              <div className="spread">
                <b>Payout float</b>
                <span className="badge pine">Withdrawable</span>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
                Funds your B2C payouts. A failed payout is returned to it automatically. You can withdraw what you do not use
                to your M-Pesa number at any time.
              </p>
            </div>
            <div className="callout pine">
              <Icon name="bolt" size={16} />
              <span>
                <b>Auto-cover.</b> If your fee credit runs out, SwiftPal can take fees from your payout float instead of
                rejecting the request. It is off by default, and you can switch it on in Settings.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="container cta-inner">
          <div>
            <h2>Processing more than KES 10M a month?</h2>
            <p>We offer volume pricing for high-throughput collections and payroll. Talk to us.</p>
          </div>
          <div className="row wrap">
            <a href={`mailto:${SITE.salesEmail}`} className="btn btn-lg cta-btn">
              Contact sales
            </a>
            <Link href="/signup" className="btn btn-lg cta-ghost">
              Start free
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
