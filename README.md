# SwiftPal

M-Pesa, programmable. STK Push collections that settle straight into the merchant's own Paybill or Till, and B2C payouts from a prefunded float. Clean REST API, signed webhooks, a real sandbox.

## Layout

```
web/     Marketing site, docs, sign-up/onboarding and the merchant dashboard (Next.js)
api/     (phase 2) Payments API, Daraja integration, ledger, webhooks
admin/   (phase 3) SwiftPal operations console
```

## Phase 1 — interface (this commit)

Everything in `web/` runs without a backend. Merchant state lives in the browser
(`web/src/lib/store.ts`) so every flow can be clicked through end to end; each
action there maps to one API call in phase 2. The dashboard says "Preview build"
and has a reset button.

| Area | Routes |
|---|---|
| Marketing | `/`, `/pricing` |
| Docs | `/docs`, `/docs/quickstart`, `/docs/authentication`, `/docs/sandbox`, `/docs/stk-push`, `/docs/payouts`, `/docs/webhooks`, `/docs/wallet`, `/docs/errors` |
| Auth | `/signup`, `/verify-email`, `/login`, `/forgot-password` |
| Onboarding | `/onboarding` — business → Till/Paybill with KES 1 verification → keys + first test payment |
| Dashboard | `/dashboard` (+ `payments`, `payouts`, `wallet`, `channels`, `developers`, `developers/webhooks`, `developers/logs`, `settings`) |

## Pricing

Single source of truth: `web/src/lib/pricing.ts`. Moves to the database when the admin console lands.

- **STK Push** — KES 2.50 flat from KES 10, free below. Charged only when the customer pays; held at initiation and released on cancel/timeout/failure.
- **B2C** — banded, KES 5 to KES 180, no percentage band. Fee refunded if the payout fails.
- Two prefunded balances: **fee credit** (non-withdrawable) and **payout float** (withdrawable). Optional auto-cover takes fees from float when credit runs out.

## Develop

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Deploy

Render web service, root directory `web`, build `npm ci && npm run build`, start `npm start`. See `render.yaml`.
