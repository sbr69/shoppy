create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.connected_sites(id) on delete cascade,
  merchant_product_id text not null,
  product_json jsonb not null,
  searchable_text text not null,
  content_hash text not null,
  embedding jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(site_id, merchant_product_id)
);
create index if not exists catalog_products_site_seen_idx on public.catalog_products(site_id, last_seen_at desc);
create index if not exists catalog_products_site_embedding_idx on public.catalog_products(site_id) where embedding is not null;
alter table public.catalog_products enable row level security;
revoke all on public.catalog_products from anon, authenticated;

create table if not exists public.user_shopping_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_shopping_preferences enable row level security;
revoke all on public.user_shopping_preferences from anon, authenticated;
