-- Durable reconciliation queue. Payment finality and merchant-order confirmation
-- are deliberately separated: a restart must never lose a paid order that still
-- needs merchant confirmation.
create table if not exists public.reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases(id) on delete cascade,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 100 check (max_attempts between 1 and 1000),
  last_error text,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reconciliation_jobs_due_idx
  on public.reconciliation_jobs (run_after asc)
  where completed_at is null and failed_at is null;

create or replace function public.enqueue_reconciliation_for_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('pending', 'payment_confirmed') and new.stellar_tx_hash is not null then
    insert into reconciliation_jobs (purchase_id, run_after)
    values (new.id, now())
    on conflict (purchase_id) do update
      set run_after = least(reconciliation_jobs.run_after, now()),
          locked_at = null,
          locked_by = null,
          last_error = null,
          updated_at = now()
      where reconciliation_jobs.completed_at is null and reconciliation_jobs.failed_at is null;
  elsif new.status in ('confirmed', 'failed') then
    update reconciliation_jobs
      set completed_at = coalesce(completed_at, now()),
          locked_at = null,
          locked_by = null,
          updated_at = now()
      where purchase_id = new.id and completed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_enqueue_reconciliation on public.purchases;
create trigger purchases_enqueue_reconciliation
after insert or update of status, stellar_tx_hash on public.purchases
for each row execute function public.enqueue_reconciliation_for_purchase();

-- Include payments created before this migration.
insert into public.reconciliation_jobs (purchase_id, run_after)
select id, now()
from public.purchases
where status in ('pending', 'payment_confirmed') and stellar_tx_hash is not null
on conflict (purchase_id) do nothing;

create or replace function public.claim_reconciliation_jobs(p_worker_id text, p_limit integer default 25)
returns table (job_id uuid, purchase_id uuid, attempt integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) < 3 then
    raise exception 'worker id is required';
  end if;

  return query
  with due as (
    select id
    from reconciliation_jobs
    where completed_at is null
      and failed_at is null
      and attempts < max_attempts
      and run_after <= now()
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by run_after asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update reconciliation_jobs as job
  set locked_at = now(),
      locked_by = p_worker_id,
      attempts = job.attempts + 1,
      updated_at = now()
  from due
  where job.id = due.id
  returning job.id, job.purchase_id, job.attempts;
end;
$$;

create or replace function public.complete_reconciliation_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update reconciliation_jobs
  set completed_at = coalesce(completed_at, now()),
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_job_id;
$$;

create or replace function public.reschedule_reconciliation_job(p_job_id uuid, p_run_after timestamptz, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update reconciliation_jobs
  set run_after = greatest(coalesce(p_run_after, now()), now() + interval '5 seconds'),
      locked_at = null,
      locked_by = null,
      last_error = left(coalesce(p_error, 'merchant confirmation pending'), 500),
      failed_at = case when attempts >= max_attempts then now() else null end,
      updated_at = now()
  where id = p_job_id and completed_at is null and failed_at is null;
$$;

revoke all on public.reconciliation_jobs from anon, authenticated;
revoke all on function public.claim_reconciliation_jobs(text, integer) from public;
revoke all on function public.complete_reconciliation_job(uuid) from public;
revoke all on function public.reschedule_reconciliation_job(uuid, timestamptz, text) from public;
