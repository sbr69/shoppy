alter table public.connected_sites add column if not exists auth_token_expires_at timestamptz, add column if not exists auth_scope text, add column if not exists authorized_at timestamptz;

alter table public.purchases drop constraint if exists purchases_status_check;
alter table public.purchases add constraint purchases_status_check check (status in ('pending', 'payment_confirmed', 'confirmed', 'failed', 'reconciliation_required'));

create table if not exists public.site_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  site_id uuid not null references public.connected_sites(id) on delete cascade,
  state_hash text not null unique,
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  code_verifier_tag text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists site_oauth_attempts_expiry_idx on public.site_oauth_attempts(expires_at) where consumed_at is null;
alter table public.site_oauth_attempts enable row level security;
revoke all on public.site_oauth_attempts from anon, authenticated;
