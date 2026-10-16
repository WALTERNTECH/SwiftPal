export const SITE = {
  name: "SwiftPal",
  domain: "swiftpal.co.ke",
  apiBase: "https://api.swiftpal.co.ke/v1",
  supportEmail: "support@swiftpal.co.ke",
  salesEmail: "sales@swiftpal.co.ke",
  tagline: "M-Pesa, programmable.",
  description:
    "SwiftPal makes M-Pesa programmable. STK Push collections into your own Paybill or Till and B2C payouts to any Safaricom number, through clean APIs and signed webhooks. No Daraja application.",
  rateLimitPerMinute: 300,
};

/** Sandbox numbers that force a specific outcome. Mirrored in the docs and the dashboard simulator. */
export const SANDBOX_NUMBERS = [
  { phone: "254700000000", outcome: "success", code: "0", note: "Customer enters PIN, payment succeeds" },
  { phone: "254700000001", outcome: "cancelled", code: "1032", note: "Customer dismisses the prompt" },
  { phone: "254700000002", outcome: "failed", code: "1", note: "Insufficient M-Pesa balance" },
  { phone: "254700000003", outcome: "expired", code: "1037", note: "Phone unreachable, prompt times out" },
] as const;
