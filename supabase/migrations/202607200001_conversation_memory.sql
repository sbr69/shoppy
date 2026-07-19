-- Durable, compact context for the agent. Raw messages remain in messages;
-- this table prevents long conversations from overflowing model context.
create table if not exists public.conversation_memories (
  session_id uuid primary key references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  summary text not null default '',
  facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_memories_user_updated_idx
  on public.conversation_memories(user_id, updated_at desc);

alter table public.conversation_memories enable row level security;
revoke all on public.conversation_memories from anon, authenticated;
