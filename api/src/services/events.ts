import type { Mode } from "../app.js";
import type { Q } from "../db.js";
import { newId } from "../lib.js";

export const EVENT_TYPES = [
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "payment.expired",
  "payout.succeeded",
  "payout.failed",
  "payout.reversed",
  "wallet.topped_up",
  "wallet.low_balance",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Records an event and queues one delivery per enabled endpoint that wants
 * it, in the same transaction as the state change it describes.
 */
export async function emit(q: Q, merchantId: string, mode: Mode, type: EventType, data: Record<string, unknown>) {
  const id = newId("evt");
  await q.query(`insert into events (id, merchant_id, mode, type, data) values ($1,$2,$3,$4,$5)`, [id, merchantId, mode, type, JSON.stringify(data)]);
  const { rows } = await q.query<{ id: string }>(
    `select id from webhook_endpoints
     where merchant_id = $1 and mode = $2 and enabled and removed_at is null and $3 = any(events)`,
    [merchantId, mode, type],
  );
  for (const ep of rows) {
    await q.query(`insert into webhook_deliveries (id, event_id, endpoint_id) values ($1,$2,$3)`, [newId("whd"), id, ep.id]);
  }
  return id;
}
