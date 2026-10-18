import { SITE } from "@/lib/site";
import { AI_PROMPT } from "@/lib/snippets";

export const dynamic = "force-static";

const API_ORIGIN = SITE.apiBase.replace(/\/v1$/, "");

/** Plain-text guide for AI assistants: what SwiftPal is, how to get a key without copy-paste, and the API. */
const BODY = `# SwiftPal

> M-Pesa STK Push collections and B2C payouts for Kenyan developers through one REST API, without Daraja configuration. Payments go straight into the merchant's own Till or Paybill.

Dashboard: ${SITE.url}/dashboard
Docs: ${SITE.url}/docs
API base URL: ${SITE.apiBase}

## For AI coding assistants: get an API key without the user copying it

1. Start a connection:
   POST ${API_ORIGIN}/connect/start
   Content-Type: application/json
   { "client_name": "<your tool, e.g. Claude Code>" }
   Response 201: { "device_code", "user_code", "approve_url", "token_url", "interval", "expires_in" }

2. Show the user approve_url and user_code. They open the link, sign in to SwiftPal, check the code matches, and click Approve.
   Their account must be verified; if it isn't, the page tells them.
   The key can request payments and read data. Sending money (payouts:write) is off unless the user ticks it on that page,
   which needs two-step verification on their account. If the project sends payouts, tell the user to tick "Send payouts".

3. Poll every interval seconds:
   POST ${API_ORIGIN}/connect/token
   { "device_code": "<device_code>" }
   202 { "status": "pending" }  keep waiting
   200 { "status": "approved", "secret_key": "sp_live_...", "api_base", "account": { "name", "account_code" } }  done
   403 access_denied  the user declined
   410 expired or already_claimed  start again
   The key is handed over once. Store it immediately.

4. Save it on the server only, as SWIFTPAL_SECRET_KEY in the project's environment (.env, and keep .env out of git). Never put it in browser or mobile code, and never print it in full.

5. Integrate using the reference below. If the project has no webhook endpoint yet, create one (for example POST /webhooks/swiftpal), then ask the user to add its public URL in the dashboard under Developers > Webhooks and set the signing secret as SWIFTPAL_WEBHOOK_SECRET.

## API reference

${AI_PROMPT}
`;

export function GET() {
  return new Response(BODY, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
