-- A basket groups independently verifiable merchant orders under one user
-- approval. Payments remain per order so a cross-merchant basket never claims
-- impossible atomic settlement.
create table if not exists public.purchase_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  state text not null check (state in ('selected', 'confirmed', 'processing', 'completed', 'partial', 'failed', 'cancelled', 'expired')),
  total_xlm numeric(20,7),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchase_intents add column if not exists batch_id uuid references public.purchase_batches(id) on delete set null;
create index if not exists purchase_batches_user_session_state_idx on public.purchase_batches(user_id, session_id, state, updated_at desc);
create index if not exists purchase_intents_batch_idx on public.purchase_intents(batch_id);
alter table public.purchase_batches enable row level security;
revoke all on public.purchase_batches from anon, authenticated;
