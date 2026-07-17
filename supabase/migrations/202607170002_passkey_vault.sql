-- Passkey-vault migration. The application must never retain an owner Stellar
-- secret. Existing test wallets used server custody, so their encrypted owner
-- material is deliberately erased and users must provision a new test wallet.

alter table public.wallets alter column public_key drop not null;
alter table public.wallets alter column encrypted_secret drop not null;
alter table public.wallets alter column iv drop not null;
alter table public.wallets alter column auth_tag drop not null;

alter table public.wallets
  add column if not exists custody_mode text not null default 'legacy_server_custody'
    check (custody_mode in ('passkey_vault', 'legacy_server_custody')),
  add column if not exists status text not null default 'setup_required'
    check (status in ('setup_required', 'active', 'revoked')),
  add column if not exists vault_ciphertext text,
  add column if not exists vault_iv text,
  add column if not exists vault_salt text,
  add column if not exists passkey_credential_id text,
  add column if not exists provisioned_at timestamptz,
  add column if not exists legacy_erased_at timestamptz;

-- Testnet reset: these values are not usable by the passkey model and must not
-- remain available to application code after this migration.
update public.wallets
set public_key = null,
    encrypted_secret = null,
    iv = null,
    auth_tag = null,
    custody_mode = 'passkey_vault',
    status = 'setup_required',
    legacy_erased_at = now()
where custody_mode = 'legacy_server_custody';

create table if not exists public.passkey_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0 check (counter >= 0),
  transports jsonb not null default '[]'::jsonb,
  device_type text,
  backed_up boolean,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  challenge text not null unique,
  purpose text not null check (purpose in ('registration', 'unlock')),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists passkey_challenges_user_expiry_idx on public.passkey_challenges(user_id, expires_at);

create table if not exists public.wallet_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null check (action_type in ('set_agent', 'set_trust_rule', 'deposit')),
  state text not null default 'prepared' check (state in ('prepared', 'submitted', 'failed', 'expired')),
  payload jsonb not null,
  transaction_xdr text not null,
  expires_at timestamptz not null,
  submitted_tx_hash text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists wallet_actions_user_expiry_idx on public.wallet_actions(user_id, state, expires_at);

create table if not exists public.purchase_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purchase_intent_id uuid not null unique references public.purchase_intents(id) on delete cascade,
  owner_public_key text not null,
  agent_public_key text not null,
  expected_auth_entry_xdr text not null,
  prepared_transaction_xdr text not null,
  valid_until_ledger_seq integer not null,
  approval_summary jsonb not null,
  state text not null default 'prepared' check (state in ('prepared', 'authorized', 'submitted', 'expired', 'failed')),
  expires_at timestamptz not null,
  authorized_at timestamptz,
  submitted_tx_hash text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists purchase_approvals_user_expiry_idx on public.purchase_approvals(user_id, state, expires_at);

alter table public.purchase_intents drop constraint if exists purchase_intents_state_check;
alter table public.purchase_intents add constraint purchase_intents_state_check check (state in (
  'selected', 'confirmed', 'policy_authorized', 'approval_required', 'approval_authorized',
  'payment_submitted', 'payment_confirmed', 'order_confirmed', 'cancelled', 'expired', 'failed'
));

alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;
alter table public.wallet_actions enable row level security;
alter table public.purchase_approvals enable row level security;
revoke all on public.passkey_credentials, public.passkey_challenges, public.wallet_actions, public.purchase_approvals from anon, authenticated;
