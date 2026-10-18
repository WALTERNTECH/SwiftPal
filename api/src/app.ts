import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { MpesaDriver } from "./mpesa/types.js";

export type Mode = "test" | "live";
export type Account = "fee" | "float";

export interface Storage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface Sms {
  send(to: string, text: string): Promise<void>;
}

export type Logger = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

/** Everything a service needs, passed explicitly so tests can swap any part. */
export type App = {
  db: Db;
  cfg: Config;
  mpesa: { test: MpesaDriver; live: MpesaDriver | null };
  storage: Storage;
  mail: Mailer;
  sms: Sms;
  log: Logger;
};

export const driverFor = (app: App, mode: Mode) => (mode === "test" ? app.mpesa.test : app.mpesa.live);
