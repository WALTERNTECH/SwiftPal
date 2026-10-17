import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Logger, Mailer, Storage } from "./app.js";

/** Files in Postgres. Fine for an MVP's ID photos; switch to Supabase Storage with two env vars. */
export function dbStorage(db: Db): Storage {
  return {
    async put(key, bytes, contentType) {
      await db.query(`insert into blobs (key, content_type, bytes) values ($1,$2,$3) on conflict (key) do update set bytes = excluded.bytes, content_type = excluded.content_type`, [
        key,
        contentType,
        bytes,
      ]);
    },
    async get(key) {
      const { rows } = await db.query<{ content_type: string; bytes: Uint8Array }>(`select content_type, bytes from blobs where key = $1`, [key]);
      return rows[0] ? { bytes: Buffer.from(rows[0].bytes), contentType: rows[0].content_type } : null;
    },
  };
}

/** A private Supabase Storage bucket, reached with the service role key. */
export function supabaseStorage(s: { url: string; serviceKey: string; bucket: string }): Storage {
  const base = `${s.url}/storage/v1/object/${s.bucket}`;
  const auth = { Authorization: `Bearer ${s.serviceKey}`, apikey: s.serviceKey };
  return {
    async put(key, bytes, contentType) {
      const res = await fetch(`${base}/${key}`, { method: "POST", headers: { ...auth, "Content-Type": contentType, "x-upsert": "true" }, body: new Uint8Array(bytes) });
      if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
    },
    async get(key) {
      const res = await fetch(`${base}/${key}`, { headers: auth });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`storage read failed: ${res.status}`);
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    },
  };
}

export function makeStorage(cfg: Config, db: Db): Storage {
  return cfg.storage.driver === "supabase" ? supabaseStorage(cfg.storage) : dbStorage(db);
}

/** Resend when a key is set; otherwise the message goes to the log so local sign-up still works. */
export function makeMailer(cfg: Config, log: Logger): Mailer {
  return {
    async send(to, subject, text) {
      if (!cfg.resendApiKey) {
        log.info(`[mail] to=${to} subject="${subject}"\n${text}`);
        return;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) log.error(`[mail] send failed ${res.status}`, await res.text().catch(() => ""));
    },
  };
}
