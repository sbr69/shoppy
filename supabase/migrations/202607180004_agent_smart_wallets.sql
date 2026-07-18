-- Each user has one deployed Agent Smart Wallet (a C... Soroban address).
-- The existing wallets table remains the server-custodial funding/withdrawal
-- account; it is never shown as the spendable shopping wallet after migration.
create table if not exists public.agent_smart_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  contract_id text not null unique check (contract_id ~ '^C[A-Z2-7]{55}$'),
  wasm_hash text not null check (wasm_hash ~ '^[0-9a-f]{64}$'),
  deployment_tx_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'provisioning', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_smart_wallets enable row level security;
revoke all on public.agent_smart_wallets from anon, authenticated;
