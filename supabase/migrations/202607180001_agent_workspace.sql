alter table public.chat_sessions add column if not exists title text not null default 'New shopping chat', add column if not exists archived_at timestamptz, add column if not exists updated_at timestamptz not null default now();
create index if not exists chat_sessions_user_updated_idx on public.chat_sessions(user_id, updated_at desc) where archived_at is null;
alter table public.connected_sites add column if not exists policy_synced_at timestamptz, add column if not exists policy_sync_error text;
create table if not exists public.workflow_events (id bigint generated always as identity primary key, user_id uuid not null references public.users(id), session_id uuid references public.chat_sessions(id) on delete cascade, purchase_intent_id uuid references public.purchase_intents(id), stage text not null, status text not null check (status in ('pending','running','completed','failed')), detail text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists workflow_events_user_created_idx on public.workflow_events(user_id, created_at desc);
create index if not exists workflow_events_intent_created_idx on public.workflow_events(purchase_intent_id, created_at desc);
alter table public.workflow_events enable row level security;
revoke all on public.workflow_events from anon, authenticated;
