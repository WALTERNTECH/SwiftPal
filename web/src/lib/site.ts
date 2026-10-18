// Addresses come from the build environment (next.config.ts). Today they are
// the Render hosts; moving to the .com is a change of env vars and a rebuild.
const url = (v: string | undefined, fallback: string) => (v || fallback).replace(/\/$/, "");
const WEB_URL = url(process.env.NEXT_PUBLIC_WEB_URL, "https://swiftpal-web.onrender.com");
const API_URL = url(process.env.NEXT_PUBLIC_API_URL, "https://swiftpal-api.onrender.com");
/** The domain mail is sent from and answered at, e.g. swiftpal.com. Contact links stay hidden until it is set. */
const MAIL_DOMAIN = process.env.NEXT_PUBLIC_MAIL_DOMAIN || null;

export const SITE = {
  name: "SwiftPal",
  url: WEB_URL,
  apiBase: `${API_URL}/v1`,
  apiHost: API_URL.replace(/^https?:\/\//, ""),
  supportEmail: MAIL_DOMAIN ? `support@${MAIL_DOMAIN}` : null,
  salesEmail: MAIL_DOMAIN ? `sales@${MAIL_DOMAIN}` : null,
  tagline: "M-Pesa, programmable.",
  description:
    "SwiftPal makes M-Pesa programmable. STK Push collections into your own Paybill or Till and B2C payouts to any Safaricom number, through clean APIs and signed webhooks. No Daraja application.",
  rateLimitPerMinute: 300,
};
