import { randomInt } from "node:crypto";
import type { App } from "../app.js";
import { newId } from "../lib.js";
import { b2cFeeCents, stkFeeCents, TEST_FEE_CREDIT_CENTS, TEST_FLOAT_CENTS } from "../pricing.js";

// Test-mode helpers for the dashboard: a history to look at, and a clean slate.
// Neither touches live data.

const DAY = 86_400_000;
const HOUR_WEIGHTS = [1, 0.5, 0.3, 0.2, 0.3, 0.8, 2, 3.5, 5, 5.5, 6, 7, 9, 8.5, 6.5, 6, 6.5, 8, 10, 11, 9, 6.5, 4, 2];
const AMOUNTS = [150, 250, 300, 450, 500, 500, 650, 800, 800, 1000, 1000, 1200, 1250, 1500, 1500, 2000, 2400, 3500, 4999, 7500];
const NAMES = ["JOHN KAMAU", "MERCY WANJIKU", "BRIAN OTIENO", "FAITH CHEBET", "KEVIN MWANGI", "ANN NJERI", "DAVID KIPRONO", "GRACE AKINYI"];
const pickHour = () => {
  let x = Math.random() * HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  for (let h = 0; h < 24; h++) if ((x -= HOUR_WEIGHTS[h]) <= 0) return h;
  return 12;
};
const phone = () => `2547${String(randomInt(0, 1e8)).padStart(8, "0")}`;
const receipt = () => "T" + Array.from({ length: 9 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[randomInt(0, 34)]).join("");

/** Sixty days of plausible sandbox history, flagged with metadata.sample = true. */
export async function seed(app: App, merchantId: string) {
  const now = Date.now();
  const midnight = now - ((now + 3 * 3_600_000) % DAY);
  await app.db.tx(async (q) => {
    let n = 0;
    for (let d = 59; d >= 0; d--) {
      const start = midnight - d * DAY;
      const weekend = [0, 6].includes(new Date(start + 3 * 3_600_000).getUTCDay());
      const count = Math.round(3 + (60 - d) * 0.17 + (weekend ? -1 : 1) + Math.random() * 2.5);
      for (let k = 0; k < count; k++) {
        const t = start + pickHour() * 3_600_000 + randomInt(0, 3_600_000);
        if (t > now) continue;
        const roll = Math.random();
        const status = roll < 0.76 ? "succeeded" : roll < 0.88 ? "cancelled" : roll < 0.95 ? "expired" : "failed";
        const amount = AMOUNTS[randomInt(0, AMOUNTS.length)];
        const fee = stkFeeCents(amount) ?? 0;
        const at = new Date(t).toISOString();
        await q.query(
          `insert into payments (id, merchant_id, mode, purpose, channel_id, phone, amount, reference, status, fee_cents, fee_account, fee_charged, mpesa_receipt, failure_code, metadata, created_at, updated_at, completed_at)
           values ($1,$2,'test','charge','sandbox_till',$3,$4,$5,$6,$7,'fee',$8,$9,$10,'{"sample":true}',$11,$11,$11)`,
          [newId("pay"), merchantId, phone(), amount, `ORD-${9000 + n}`, status, fee, status === "succeeded" && fee > 0, status === "succeeded" ? receipt() : null, { succeeded: null, cancelled: "1032", expired: "1037", failed: "1" }[status], at],
        );
        n++;
      }
      for (let k = 0; k < randomInt(1, 4); k++) {
        const t = start + randomInt(8, 20) * 3_600_000 + randomInt(0, 3_600_000);
        if (t > now) continue;
        const amount = [500, 1000, 1500, 2500, 3500, 5000, 8000, 12500][randomInt(0, 8)];
        const ok = Math.random() > 0.07;
        const at = new Date(t).toISOString();
        await q.query(
          `insert into payouts (id, merchant_id, mode, purpose, phone, amount, reference, reason, status, fee_cents, fee_account, recipient_name, mpesa_receipt, failure_code, originator_conversation_id, metadata, created_at, updated_at, completed_at)
           values ($1,$2,'test','payout',$3,$4,$5,$6,$7,$8,'fee',$9,$10,$11,$12,'{"sample":true}',$13,$13,$13)`,
          [newId("po"), merchantId, phone(), amount, `WD-${21000 + n}`, ["withdrawal", "refund", "commission"][randomInt(0, 3)], ok ? "succeeded" : "failed", b2cFeeCents(amount), ok ? NAMES[randomInt(0, NAMES.length)] : null, ok ? receipt() : null, ok ? null : "2040", `SP-SAMPLE-${newId("x")}`, at],
        );
        n++;
      }
    }
  });
}

/** Clears test-mode activity and restores the starting test balances. */
export async function reset(app: App, merchantId: string) {
  await app.db.tx(async (q) => {
    await q.query(`delete from webhook_deliveries where event_id in (select id from events where merchant_id = $1 and mode = 'test')`, [merchantId]);
    await q.query(`delete from events where merchant_id = $1 and mode = 'test'`, [merchantId]);
    await q.query(`delete from payments where merchant_id = $1 and mode = 'test' and purpose <> 'channel_verify'`, [merchantId]);
    await q.query(`delete from payouts where merchant_id = $1 and mode = 'test'`, [merchantId]);
    await q.query(`delete from payout_batches where merchant_id = $1 and mode = 'test'`, [merchantId]);
    await q.query(`delete from ledger_entries where merchant_id = $1 and mode = 'test'`, [merchantId]);
    await q.query(`delete from request_logs where merchant_id = $1 and mode = 'test'`, [merchantId]);
    await q.query(`update balances set available_cents = case account when 'fee' then $2::bigint else $3::bigint end, held_cents = 0 where merchant_id = $1 and mode = 'test'`, [
      merchantId,
      TEST_FEE_CREDIT_CENTS,
      TEST_FLOAT_CENTS,
    ]);
  });
}
