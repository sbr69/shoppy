-- Production Supabase PostgreSQL schema. Apply with `supabase db push`.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(), google_sub text not null unique,
  email text not null, name text not null, avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.users(id) on delete cascade,
  public_key text not null unique, encrypted_secret text not null, iv text not null, auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0), created_at timestamptz not null default now()
);
create table if not exists public.agent_wallets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.users(id) on delete cascade,
  public_key text not null unique, encrypted_secret text not null, iv text not null, auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0), status text not null default 'active' check (status in ('active','revoked','rotating')),
  created_at timestamptz not null default now(), revoked_at timestamptz
);
create table if not exists public.connected_sites (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  site_url text not null, site_name text not null, adapter_id text not null, merchant_stellar_address text not null,
  merchant_domain_hash text not null, auth_token_ciphertext text, auth_token_iv text, auth_token_tag text,
  spending_cap numeric(20,7) not null check (spending_cap >= 0), per_transaction_cap numeric(20,7) not null check (per_transaction_cap >= 0),
  auto_confirm_threshold numeric(20,7) not null default 0 check (auto_confirm_threshold >= 0),
  category text not null default 'general', trust_rule_version integer not null default 1,
  status text not null default 'pending_authorization' check (status in ('pending_authorization','active','paused','revoked')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (user_id, site_url)
);
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','agent','system')), content text not null check (char_length(content) <= 4000),
  metadata jsonb, created_at timestamptz not null default now()
);
create table if not exists public.purchase_intents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), session_id uuid not null references public.chat_sessions(id),
  site_id uuid not null references public.connected_sites(id), product_json jsonb not null, quantity integer not null check(quantity between 1 and 100),
  price_xlm numeric(20,7), final_total_json jsonb, merchant_order_id text,
  state text not null check (state in ('selected','confirmed','policy_authorized','payment_submitted','payment_confirmed','order_confirmed','cancelled','expired','failed')),
  reserved_xlm numeric(20,7) not null default 0, idempotency_key uuid not null unique, policy_tx_hash text,
  expires_at timestamptz not null, confirmed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), site_id uuid references public.connected_sites(id),
  purchase_intent_id uuid not null unique references public.purchase_intents(id), product_name text not null, product_url text, product_image text,
  price_xlm numeric(20,7) not null check(price_xlm > 0), stellar_tx_hash text unique, receipt_memo_hash text not null, receipt_event_id text,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','reconciliation_required')),
  created_at timestamptz not null default now(), confirmed_at timestamptz
);
create table if not exists public.audit_events (
  id bigint generated always as identity primary key, user_id uuid references public.users(id), purchase_intent_id uuid references public.purchase_intents(id),
  event_type text not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists messages_session_created_idx on public.messages(session_id, created_at);
create index if not exists purchases_user_created_idx on public.purchases(user_id, created_at desc);
create index if not exists intents_user_state_expiry_idx on public.purchase_intents(user_id, state, expires_at);

create or replace function public.reserve_purchase_intent(p_intent_id uuid, p_user_id uuid, p_site_id uuid)
returns public.purchase_intents language plpgsql security definer set search_path = public as $$
declare v_intent public.purchase_intents; v_cap numeric(20,7); v_consumed numeric(20,7);
begin
  select * into v_intent from purchase_intents where id=p_intent_id and user_id=p_user_id and site_id=p_site_id and state='confirmed' for update;
  if not found or v_intent.price_xlm is null or v_intent.price_xlm <= 0 then raise exception 'purchase confirmation is no longer valid'; end if;
  select spending_cap into v_cap from connected_sites where id=p_site_id and user_id=p_user_id and status='active' for update;
  if not found then raise exception 'store is not active'; end if;
  select coalesce(sum(amount), 0) into v_consumed from (
    select price_xlm amount from purchases where user_id=p_user_id and site_id=p_site_id and status='confirmed' and created_at >= date_trunc('day', now() at time zone 'utc')
    union all select reserved_xlm from purchase_intents where user_id=p_user_id and site_id=p_site_id and state in ('policy_authorized','payment_submitted','payment_confirmed') and created_at >= date_trunc('day', now() at time zone 'utc')
  ) s;
  if v_consumed + v_intent.price_xlm > v_cap then raise exception 'purchase exceeds remaining daily allowance'; end if;
  update purchase_intents set state='policy_authorized', reserved_xlm=v_intent.price_xlm, updated_at=now() where id=p_intent_id returning * into v_intent;
  return v_intent;
end $$;

alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.agent_wallets enable row level security;
alter table public.connected_sites enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages enable row level security;
alter table public.purchase_intents enable row level security;
alter table public.purchases enable row level security;
alter table public.audit_events enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on function public.reserve_purchase_intent(uuid, uuid, uuid) from public;
