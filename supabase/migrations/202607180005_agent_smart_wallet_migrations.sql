-- Contract code is immutable. Keep a durable record whenever an Agent Smart
-- Wallet moves to a newer code hash so recovery never depends on application
-- logs or an operator's memory.
create table if not exists public.agent_smart_wallet_migrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  from_contract_id text not null check (from_contract_id ~ '^C[A-Z2-7]{55}$'),
  to_contract_id text not null unique check (to_contract_id ~ '^C[A-Z2-7]{55}$'),
  to_wasm_hash text not null check (to_wasm_hash ~ '^[0-9a-f]{64}$'),
  deployment_tx_hash text not null unique,
  transfer_tx_hash text unique,
  status text not null check (status in ('deployed', 'funds_transferred', 'completed', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists agent_smart_wallet_migrations_user_created_idx
  on public.agent_smart_wallet_migrations (user_id, created_at desc);

alter table public.agent_smart_wallet_migrations enable row level security;
revoke all on public.agent_smart_wallet_migrations from anon, authenticated;
