import type { App } from "./app.js";
import { loadConfig } from "./config.js";
import { pgDb, pgliteDb } from "./db.js";
import { makeMailer, makeStorage } from "./infra.js";
import { migrate } from "./migrate.js";
import { DarajaClient } from "./mpesa/daraja.js";
import { SandboxDriver } from "./mpesa/sandbox.js";
import { handleStkResult } from "./services/payments.js";
import { handleB2cResult } from "./services/payouts.js";
import { buildServer } from "./server.js";
import { startWorker } from "./worker.js";

/** Wires config, database, M-Pesa drivers and storage into one App. */
export async function createApp(overrides: Partial<App> = {}): Promise<App> {
  const cfg = overrides.cfg ?? loadConfig();
  const log = overrides.log ?? { info: console.log, warn: console.warn, error: console.error };
  const db = overrides.db ?? (cfg.databaseUrl ? pgDb(cfg.databaseUrl) : await pgliteDb());
  const app = {
    cfg,
    log,
    db,
    storage: overrides.storage ?? makeStorage(cfg, db),
    mail: overrides.mail ?? makeMailer(cfg, log),
    mpesa: { test: null, live: null },
  } as unknown as App;
  // The sandbox answers through the same handlers a real Safaricom callback reaches.
  app.mpesa = overrides.mpesa ?? {
    test: new SandboxDriver({ stk: (r) => handleStkResult(app, r), b2c: (r) => handleB2cResult(app, r) }, cfg.sandboxDelayMs),
    live: cfg.daraja ? new DarajaClient(cfg.daraja) : null,
  };
  return app;
}

async function main() {
  const app = await createApp();
  await migrate(app.db, app.log.info);
  const server = await buildServer(app);
  const stop = startWorker(app);
  await server.listen({ port: app.cfg.port, host: "0.0.0.0" });
  app.log.info(`SwiftPal API on :${app.cfg.port} · live M-Pesa ${app.mpesa.live ? `on (${app.cfg.daraja!.env})` : "off"} · storage ${app.cfg.storage.driver}`);
  const shutdown = async () => {
    stop();
    await server.close();
    await app.db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.argv[1] && /index\.(js|ts)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
