// Schema for the swiftpal schema. Money is integer cents everywhere.
// Append new migrations; never edit one that has run.

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_core",
    sql: `
create table merchants (
  id text primary key,
  account_code text not null unique,
  name text not null,
  type text not null default 'individual' check (type in ('individual','company','ngo')),
  industry text,
  monthly_volume text,
  website text,
  verification_status text not null default 'not_started' check (verification_status in ('not_started','submitted','approved','rejected')),
  auto_cover boolean not null default false,
  low_balance_at_cents bigint not null default 20000,
  starter_credit_given boolean not null default false,
  onboarding_done boolean not null default false,
  live_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table users (
  id text primary key,
  merchant_id text not null references merchants(id),
  email text not null unique,
  phone text not null,
  first_name text not null,
  last_name text not null,
  password_hash text not null,
  role text not null default 'owner',
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table email_codes (
  id bigint generated always as identity primary key,
  user_id text not null references users(id),
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id text not null references users(id),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions(user_id);

create table api_keys (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null check (mode in ('test','live')),
  name text not null,
  prefix text not null,
  last4 text not null,
  key_hash text not null unique,
  -- test keys only, so the dashboard can show them again; live keys are shown once
  secret_enc text,
  scopes text[] not null,
  ip_allowlist text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_merchant on api_keys(merchant_id);

create table channels (
  id text primary key,
  merchant_id text not null references merchants(id),
  kind text not null check (kind in ('till','paybill')),
  shortcode text not null,
  account_number text,
  display_name text not null,
  status text not null default 'unverified' check (status in ('unverified','verifying','verified')),
  is_default boolean not null default false,
  -- 'linked': the merchant linked this shortcode to SwiftPal's Daraja app and shared its passkey.
  -- 'platform': prompts go out under SwiftPal's own M-Pesa Express shortcode.
  credential_mode text not null default 'platform' check (credential_mode in ('platform','linked')),
  business_shortcode text,
  passkey_enc text,
  verify_payment_id text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  removed_at timestamptz,
  check (kind <> 'paybill' or account_number is not null)
);
create unique index channels_unique on channels(merchant_id, shortcode) where removed_at is null;

create table balances (
  merchant_id text not null references merchants(id),
  mode text not null check (mode in ('test','live')),
  account text not null check (account in ('fee','float')),
  available_cents bigint not null default 0 check (available_cents >= 0),
  held_cents bigint not null default 0 check (held_cents >= 0),
  primary key (merchant_id, mode, account)
);

create table ledger_entries (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  account text not null check (account in ('fee','float')),
  kind text not null,
  amount_cents bigint not null,
  ref text,
  created_at timestamptz not null default now()
);
create index ledger_merchant on ledger_entries(merchant_id, mode, created_at desc);

create table payments (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  purpose text not null default 'charge' check (purpose in ('charge','topup','channel_verify')),
  channel_id text,
  phone text not null,
  amount bigint not null,
  reference text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','confirming','succeeded','failed','cancelled','expired')),
  fee_cents bigint not null default 0,
  fee_account text,
  fee_charged boolean not null default false,
  topup_account text,
  mpesa_receipt text,
  failure_code text,
  failure_message text,
  merchant_request_id text,
  checkout_request_id text unique,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index payments_merchant on payments(merchant_id, mode, created_at desc);
create index payments_open on payments(status, created_at) where status in ('pending','confirming');

create table payout_batches (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  reference text,
  count int not null,
  total bigint not null,
  created_at timestamptz not null default now()
);

create table payouts (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  purpose text not null default 'payout' check (purpose in ('payout','withdrawal')),
  batch_id text references payout_batches(id),
  phone text not null,
  amount bigint not null,
  reference text not null,
  reason text not null,
  status text not null default 'queued' check (status in ('queued','processing','succeeded','failed','reversed')),
  fee_cents bigint not null,
  fee_account text not null,
  recipient_name text,
  mpesa_receipt text,
  conversation_id text,
  originator_conversation_id text unique,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index payouts_merchant on payouts(merchant_id, mode, created_at desc);
create index payouts_queue on payouts(status, created_at) where status in ('queued','processing');

create table events (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  type text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index events_merchant on events(merchant_id, mode, created_at desc);

create table webhook_endpoints (
  id text primary key,
  merchant_id text not null references merchants(id),
  mode text not null,
  url text not null,
  events text[] not null,
  secret_enc text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

create table webhook_deliveries (
  id text primary key,
  event_id text not null references events(id),
  endpoint_id text not null references webhook_endpoints(id),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status int,
  last_error text,
  last_duration_ms int,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);
create index deliveries_due on webhook_deliveries(next_attempt_at) where status = 'pending';

create table idempotency_keys (
  merchant_id text not null,
  mode text not null,
  key text not null,
  request_hash text not null,
  status int,
  body jsonb,
  created_at timestamptz not null default now(),
  primary key (merchant_id, mode, key)
);

create table request_logs (
  id text primary key,
  merchant_id text not null,
  mode text not null,
  key_id text,
  method text not null,
  path text not null,
  status int not null,
  duration_ms int not null,
  ip text,
  request_body jsonb,
  response_body jsonb,
  created_at timestamptz not null default now()
);
create index request_logs_merchant on request_logs(merchant_id, mode, created_at desc);


create table verifications (
  id text primary key,
  merchant_id text not null references merchants(id),
  kind text not null check (kind in ('individual','business')),
  name text not null,
  id_number_enc text not null,
  reg_number text,
  kra_pin text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  reviewer_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table verification_files (
  id text primary key,
  verification_id text not null references verifications(id),
  doc_key text not null,
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  storage_key text not null
);

create table blobs (
  key text primary key,
  content_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

-- Raw Daraja callbacks, kept for audit and replay.
create table daraja_callbacks (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null,
  ref text,
  outcome text,
  received_at timestamptz not null default now()
);
`,
  },
  {
    id: "002_password_resets",
    sql: `
create table password_resets (
  token_hash text primary key,
  user_id text not null references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_resets_user on password_resets(user_id);
`,
  },
];
