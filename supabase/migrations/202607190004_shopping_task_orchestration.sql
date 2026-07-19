-- Durable, structured working memory for one active shopping task per chat.
-- This is deliberately separate from raw chat transcripts and payment intents:
-- it records what the user is trying to accomplish, never an approval.
create table if not exists public.shopping_tasks (
  session_id uuid primary key references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  goal jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_tasks_user_updated_idx on public.shopping_tasks(user_id, updated_at desc);
alter table public.shopping_tasks enable row level security;
revoke all on public.shopping_tasks from anon, authenticated;
