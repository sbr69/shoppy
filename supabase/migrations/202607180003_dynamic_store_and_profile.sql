alter table public.connected_sites
  add column if not exists oauth_server_metadata jsonb,
  add column if not exists agent_manifest jsonb,
  add column if not exists oauth_client_ciphertext text,
  add column if not exists oauth_client_iv text,
  add column if not exists oauth_client_tag text;

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  encrypted_payload text not null,
  iv text not null,
  auth_tag text not null,
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon, authenticated;
