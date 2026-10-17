import pg from "pg";

// A minimal query interface both node-postgres and PGlite satisfy, so the
// same services run against Supabase in production and an in-process
// Postgres in tests.

export type Row = Record<string, unknown>;
export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
}
export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const SCHEMA = "swiftpal";

// bigint and numeric come back as strings; amounts are cents and fit in a double.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export function pgDb(url: string): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30_000,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pg pool error", e.message));
  const wrap = (c: pg.Pool | pg.PoolClient): Q => ({
    query: (sql, params) => c.query(sql, params as unknown[]) as never,
    exec: async (sql) => {
      await c.query(sql);
    },
  });
  return {
    // Every statement names its schema through search_path, set per transaction
    // and on the role, because a pooler may hand us any backend connection.
    query: async (sql, params) => {
      const c = await pool.connect();
      try {
        await c.query(`set search_path to ${SCHEMA}, public`);
        return (await c.query(sql, params as unknown[])) as never;
      } finally {
        c.release();
      }
    },
    exec: async (sql) => {
      const c = await pool.connect();
      try {
        await c.query(`set search_path to ${SCHEMA}, public`);
        await c.query(sql);
      } finally {
        c.release();
      }
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`set local search_path to ${SCHEMA}, public`);
        const out = await fn(wrap(c));
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres for tests and local development without a server. */
export async function pgliteDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite();
  await lite.exec(`create schema if not exists ${SCHEMA}; set search_path to ${SCHEMA}, public;`);
  const norm = (r: { rows: unknown[] }) => ({ rows: (r.rows as Row[]).map(fixInts) }) as never;
  return {
    query: (sql, params) => lite.query(sql, params as unknown[]).then(norm),
    exec: async (sql) => {
      await lite.exec(sql);
    },
    // PGlite runs one transaction at a time and queues everything else behind it.
    tx: (fn) =>
      lite.transaction((t) =>
        fn({
          query: (sql, params) => t.query(sql, params as unknown[]).then(norm),
          exec: async (sql) => {
            await t.exec(sql);
          },
        }),
      ),
    close: () => lite.close(),
  };
}

function fixInts(r: Row): Row {
  for (const k of Object.keys(r)) if (typeof r[k] === "bigint") r[k] = Number(r[k]);
  return r;
}

export async function one<T extends Row>(q: Q, sql: string, params?: unknown[]): Promise<T | null> {
  const { rows } = await q.query<T>(sql, params);
  return rows[0] ?? null;
}
