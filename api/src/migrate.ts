import { loadConfig } from "./config.js";
import { pgDb, SCHEMA, type Db } from "./db.js";
import { MIGRATIONS } from "./migrations.js";

/** Applies pending migrations in order, each in its own transaction. */
export async function migrate(db: Db, log: (m: string) => void = () => {}) {
  // In production the schema is pre-created and owned by a role that can't create
  // schemas, and "create schema if not exists" checks that right even when it exists.
  const { rows: has } = await db.query(`select 1 from pg_namespace where nspname = $1`, [SCHEMA]);
  if (!has.length) await db.exec(`create schema ${SCHEMA}`);
  await db.exec(`create table if not exists ${SCHEMA}.schema_migrations (id text primary key, at timestamptz not null default now())`);
  const { rows } = await db.query<{ id: string }>(`select id from ${SCHEMA}.schema_migrations`);
  const done = new Set(rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (q) => {
      await q.exec(`set local search_path to ${SCHEMA}, public`);
      await q.exec(m.sql);
      await q.query(`insert into ${SCHEMA}.schema_migrations (id) values ($1)`, [m.id]);
    });
    log(`migrated ${m.id}`);
  }
}

// `node dist/migrate.js` runs against DATABASE_URL.
if (process.argv[1] && /migrate\.(js|ts)$/.test(process.argv[1])) {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = pgDb(cfg.databaseUrl);
  migrate(db, console.log)
    .then(() => db.close())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
