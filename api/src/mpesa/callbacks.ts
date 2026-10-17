import type { B2cResult, StkResult } from "./types.js";

type Item = { Name?: string; Key?: string; Value?: unknown };
const pick = (items: Item[] | undefined, name: string) => items?.find((i) => (i.Name ?? i.Key) === name)?.Value;

/**
 * Safaricom's STK callback:
 * { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc,
 *   CallbackMetadata?: { Item: [{ Name: "Amount", Value }, { Name: "MpesaReceiptNumber", Value }, ...] } } } }
 * Metadata is looked up by Name, never by position.
 */
export function parseStkCallback(body: unknown): StkResult | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
  const items = (cb.CallbackMetadata as { Item?: Item[] } | undefined)?.Item;
  const amount = pick(items, "Amount");
  const phone = pick(items, "PhoneNumber");
  const receipt = pick(items, "MpesaReceiptNumber");
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: typeof cb.MerchantRequestID === "string" ? cb.MerchantRequestID : undefined,
    resultCode: String(cb.ResultCode ?? ""),
    resultDesc: String(cb.ResultDesc ?? ""),
    receipt: typeof receipt === "string" ? receipt : undefined,
    amount: amount === undefined ? undefined : Number(amount),
    phone: phone === undefined ? undefined : String(phone),
  };
}

/**
 * Safaricom's B2C result:
 * { Result: { ResultType, ResultCode, ResultDesc, OriginatorConversationID, ConversationID, TransactionID,
 *   ResultParameters?: { ResultParameter: [{ Key, Value }] } } }
 * ReceiverPartyPublicName arrives as "2547XXXXXXXX - FIRST LAST".
 */
export function parseB2cResult(body: unknown): B2cResult | null {
  const r = (body as { Result?: Record<string, unknown> })?.Result;
  if (!r || typeof r.OriginatorConversationID !== "string") return null;
  const params = (r.ResultParameters as { ResultParameter?: Item[] | Item } | undefined)?.ResultParameter;
  const items = Array.isArray(params) ? params : params ? [params] : undefined;
  const name = pick(items, "ReceiverPartyPublicName");
  const amount = pick(items, "TransactionAmount");
  const receipt = pick(items, "TransactionReceipt") ?? r.TransactionID;
  return {
    originatorConversationId: r.OriginatorConversationID,
    conversationId: typeof r.ConversationID === "string" ? r.ConversationID : undefined,
    resultCode: String(r.ResultCode ?? ""),
    resultDesc: String(r.ResultDesc ?? ""),
    receipt: typeof receipt === "string" && receipt ? receipt : undefined,
    recipientName: typeof name === "string" ? name.split(" - ").slice(1).join(" - ").trim() || undefined : undefined,
    amount: amount === undefined ? undefined : Number(amount),
  };
}

/** Queue timeout: Safaricom never processed the request, so it is safe to treat as failed. */
export function parseB2cTimeout(body: unknown): B2cResult | null {
  const r = parseB2cResult(body);
  return r ? { ...r, resultCode: r.resultCode || "timeout", resultDesc: r.resultDesc || "Request timed out in the M-Pesa queue" } : null;
}

/** M-Pesa result codes we explain in plain words. Everything else is a generic failure. */
export const STK_OUTCOME: Record<string, { status: "succeeded" | "cancelled" | "expired" | "failed"; message: string }> = {
  "0": { status: "succeeded", message: "Paid" },
  "1032": { status: "cancelled", message: "Customer cancelled the prompt" },
  "1037": { status: "expired", message: "No response from the phone in time" },
  "1": { status: "failed", message: "Insufficient M-Pesa balance" },
  "2001": { status: "failed", message: "Wrong M-Pesa PIN" },
  "1001": { status: "failed", message: "Customer has another transaction in progress" },
  "1019": { status: "expired", message: "Prompt expired" },
  "1025": { status: "failed", message: "M-Pesa could not send the prompt" },
  "9999": { status: "failed", message: "M-Pesa could not send the prompt" },
  "2028": { status: "failed", message: "This shortcode is not linked to SwiftPal for M-Pesa Express" },
};

export function stkOutcome(code: string) {
  return STK_OUTCOME[code] ?? { status: "failed" as const, message: "M-Pesa declined the payment" };
}
