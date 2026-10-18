import type { App } from "../app.js";
import { ApiError } from "../lib.js";
import { audit } from "./admins.js";

// Switches the console flips for the whole platform, for incidents and
// maintenance: stop money going out, stop new prompts, stop sign-ups, and
// show every merchant a notice. Read on every money request, so they're
// cached for a few seconds.

export type Announcement = { text: string; tone: "info" | "warning" } | null;
export type Settings = {
  payouts_paused: boolean;
  payments_paused: boolean;
  signups_paused: boolean;
  announcement: Announcement;
};

const DEFAULTS: Settings = { payouts_paused: false, payments_paused: false, signups_paused: false, announcement: null };
const TTL_MS = 5_000;
let cached: { at: number; value: Settings } | null = null;

export async function settings(app: App): Promise<Settings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { rows } = await app.db.query<{ key: string; value: unknown }>(`select key, value from platform_settings`);
  const value = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) (value as Record<string, unknown>)[r.key] = r.value;
  cached = { at: Date.now(), value };
  return value;
}

export async function update(app: App, adminId: string | null, patch: Partial<Settings>, ip?: string) {
  const before = await settings(app);
  await app.db.tx(async (q) => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      await q.query(
        `insert into platform_settings (key, value, updated_by, updated_at) values ($1,$2,$3, now())
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), adminId],
      );
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && JSON.stringify(before[k as keyof Settings]) !== JSON.stringify(v)));
    if (Object.keys(changed).length) await audit(q, adminId, "platform.updated", { type: "platform", id: "settings" }, { before: pick(before, changed), after: changed }, ip);
  });
  cached = null;
  return settings(app);
}

const pick = (s: Settings, keys: object) => Object.fromEntries(Object.keys(keys).map((k) => [k, s[k as keyof Settings]]));

export async function assertPayoutsOpen(app: App) {
  if ((await settings(app)).payouts_paused)
    throw new ApiError(503, "payouts_paused", "Payouts are paused for maintenance. Your float is safe; try again shortly.", "api_error");
}

export async function assertPaymentsOpen(app: App) {
  if ((await settings(app)).payments_paused)
    throw new ApiError(503, "payments_paused", "Payment prompts are paused for maintenance. Try again shortly.", "api_error");
}

export async function assertSignupsOpen(app: App) {
  if ((await settings(app)).signups_paused) throw new ApiError(503, "signups_paused", "New sign-ups are paused for a short while. Try again later.", "api_error");
}

/** Tests flip settings directly in the database. */
export const forgetSettings = () => {
  cached = null;
};
