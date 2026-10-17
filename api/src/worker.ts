import type { App } from "./app.js";
import { reconcilePayments } from "./services/payments.js";
import { dispatchQueued, reconcilePayouts } from "./services/payouts.js";
import { deliverDue } from "./services/webhooks.js";

/**
 * Background loops, run in the API process. One instance on Render, so no
 * leader election; every step claims rows with locks anyway.
 */
export function startWorker(app: App) {
  let stopped = false;
  const loop = (name: string, everyMs: number, step: () => Promise<unknown>) => {
    const tick = async () => {
      if (stopped) return;
      try {
        await step();
      } catch (e) {
        app.log.error(`worker ${name} failed`, (e as Error).message);
      }
      if (!stopped) setTimeout(tick, everyMs).unref();
    };
    setTimeout(tick, everyMs).unref();
  };
  loop("webhooks", 2_000, () => deliverDue(app));
  loop("payout-queue", 1_000, () => dispatchQueued(app));
  loop("reconcile", 30_000, async () => {
    await reconcilePayments(app);
    await reconcilePayouts(app);
  });
  loop("housekeeping", 3_600_000, async () => {
    await app.db.query(`delete from idempotency_keys where created_at < now() - interval '24 hours'`);
    await app.db.query(`delete from request_logs where created_at < now() - interval '30 days'`);
    await app.db.query(`delete from sessions where expires_at < now()`);
  });
  return () => {
    stopped = true;
  };
}
