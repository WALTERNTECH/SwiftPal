# SwiftPal

M-Pesa, programmable. STK Push collections into the merchant's own Paybill or Till, and B2C payouts from a prefunded float. Clean REST API, signed webhooks, a real sandbox.

## Layout

```
web/     Marketing site, docs, sign-up/onboarding and the merchant dashboard (Next.js)
api/     Payments API: accounts, keys, wallet ledger, STK Push, B2C, webhooks, verification, Daraja (Fastify)
admin/   Operations console: KYC review, merchants, manual reconciliation, audit log (Next.js, own service)
```

## API (`api/`)

| Surface | Auth | What |
|---|---|---|
| `/v1/*` | `Authorization: Bearer sp_test_…` / `sp_live_…` (Basic with the key as username also works) | `stk-push`, `payments`, `payouts`, `payouts/batches`, `balance`, `events` |
| `/app/*` | `sp_session` httpOnly cookie + `X-Requested-With: SwiftPal` | Everything the dashboard does |
| `/callbacks/daraja/{stk,b2c-result,b2c-timeout}/:token` | secret path token | Safaricom results |
| `/connect/{start,token}` | none (device code) | An AI assistant asks for a key; the merchant approves at `/connect` in the dashboard |
| `/admin/*` | `sp_admin` cookie (password + TOTP) through the admin gateway, or `Bearer ADMIN_TOKEN` | The operations console |

How money moves:

- **Fee credit** and **payout float** per merchant and mode, in integer cents, with database checks that neither goes negative. Requests *hold* money; M-Pesa's answer *captures* or *releases* it, exactly once, under a row lock. Captures and credits write ledger entries.
- **STK Push** holds KES 2.50 (free under KES 10), charged only on success. Live success callbacks are re-read with STK Query before they are trusted — Safaricom signs nothing. A reconciler resolves prompts whose callback never came.
- **B2C** holds amount + fee; a failure refunds both. Batches reserve all-or-nothing and are sent by the worker. Live float is only ever released on M-Pesa's own answer.
- **Channels** are `linked` (merchant's own shortcode + passkey, linked to SwiftPal's Daraja app) or `platform` (SwiftPal's M-Pesa Express shortcode with the merchant's till/paybill as PartyB). Paybills always carry their account number. A KES 1 prompt to the owner's phone verifies a channel and turns on live mode.
- **Test mode** (`sp_test_` keys) runs against SwiftPal's sandbox driver, which answers in Daraja's shapes through the same handlers. Numbers `254700000001/2/3` force cancelled / insufficient funds / timeout.

Database: the `swiftpal` schema in Supabase, owned by the `swiftpal_api` role, which has no grants outside it. Migrations run at boot (`src/migrations.ts`, append-only).

```bash
cd api
npm install
npm test            # 25 end-to-end tests on an in-process Postgres
npm run dev         # http://localhost:4000, in-process Postgres unless DATABASE_URL is set
```

Settings are listed in `api/.env.example`. Without Daraja credentials the API runs sandbox-only and live requests return `503 live_not_configured`.

## Web (`web/`)

Marketing site, docs, onboarding and dashboard. The dashboard still keeps preview state in the browser (`web/src/lib/store.ts`); wiring it to `/app/*` is the next step.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

## Pricing

`api/src/pricing.ts` and `web/src/lib/pricing.ts` (moves to the database with the admin console).

- **STK Push** — KES 2.50 flat from KES 10, free below, charged only when the customer pays.
- **B2C** — banded, KES 5 to KES 180, no percentage band. Fee refunded if the payout fails.

## Deploy

Render: `swiftpal-web` (build `cd web && npm ci && npm run build`), `swiftpal-api` (build `cd api && npm ci --include=dev && npm run build`, start `cd api && npm start`) and `swiftpal-admin` (build `cd admin && npm ci && npm run build`, start `cd admin && npm start`). The admin console is its own service on its own URL, linked from nowhere; it forwards only `/admin/*` to the API with `ADMIN_GATEWAY_SECRET`, which both services share. The first owner signs up at `/setup` with `ADMIN_TOKEN` as the setup key. Pushes do not auto-deploy; trigger from Render.
