create table if not exists public.bridge_jobs (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  created_by uuid null default auth.uid() references auth.users(id) on delete set null,
  provider text not null check (provider in ('gemini')),
  payload text not null,
  payload_variant text not null default 'full' check (payload_variant in ('full', 'followup')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  session_key text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  runner_id text null,
  runner_details jsonb not null default '{}'::jsonb,
  raw_response text null,
  error_code text null,
  error_message text null,
  claimed_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bridge_jobs_stream_id_created_at
on public.bridge_jobs(stream_id, created_at desc);

create index if not exists idx_bridge_jobs_status_provider_created_at
on public.bridge_jobs(status, provider, created_at asc);

create index if not exists idx_bridge_jobs_session_key_created_at
on public.bridge_jobs(session_key, created_at desc);

create or replace trigger update_bridge_jobs_updated_at
before update on public.bridge_jobs
for each row
execute function public.update_updated_at_column();

alter table public.bridge_jobs enable row level security;

drop policy if exists "No hard deletes on bridge_jobs" on public.bridge_jobs;
create policy "No hard deletes on bridge_jobs"
on public.bridge_jobs
for delete
using (false);

drop policy if exists "Users can view bridge jobs in their streams" on public.bridge_jobs;
create policy "Users can view bridge jobs in their streams"
on public.bridge_jobs
for select
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can insert bridge jobs in their streams" on public.bridge_jobs;
create policy "Users can insert bridge jobs in their streams"
on public.bridge_jobs
for insert
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can update bridge jobs in their streams" on public.bridge_jobs;
create policy "Users can update bridge jobs in their streams"
on public.bridge_jobs
for update
using (public.user_can_access_stream(stream_id))
with check (public.user_can_access_stream(stream_id));

create or replace function public.claim_next_bridge_job(
  p_provider text default 'gemini',
  p_runner_id text default null
)
returns setof public.bridge_jobs
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_job public.bridge_jobs%rowtype;
begin
  select *
  into v_job
  from public.bridge_jobs
  where status = 'queued'
    and provider = p_provider
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.bridge_jobs
  set status = 'running',
      runner_id = coalesce(p_runner_id, runner_id),
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

grant execute on function public.claim_next_bridge_job(text, text) to service_role;
