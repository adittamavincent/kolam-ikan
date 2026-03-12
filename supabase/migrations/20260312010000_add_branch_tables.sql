create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (stream_id, name)
);

create table if not exists public.commit_branches (
  commit_id uuid not null references public.entries(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (commit_id, branch_id)
);

create index if not exists idx_branches_stream_id on public.branches(stream_id);
create index if not exists idx_commit_branches_branch_id on public.commit_branches(branch_id);

create or replace trigger update_branches_updated_at
before update on public.branches
for each row
execute function public.update_updated_at_column();

alter table public.branches enable row level security;
alter table public.commit_branches enable row level security;

drop policy if exists "No hard deletes on branches" on public.branches;
create policy "No hard deletes on branches"
on public.branches
for delete
using (false);

drop policy if exists "Users can view branches in their streams" on public.branches;
create policy "Users can view branches in their streams"
on public.branches
for select
using (
  exists (
    select 1
    from public.streams s
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where s.id = branches.stream_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert branches in their streams" on public.branches;
create policy "Users can insert branches in their streams"
on public.branches
for insert
with check (
  exists (
    select 1
    from public.streams s
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where s.id = branches.stream_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can update branches in their streams" on public.branches;
create policy "Users can update branches in their streams"
on public.branches
for update
using (
  exists (
    select 1
    from public.streams s
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where s.id = branches.stream_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.streams s
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where s.id = branches.stream_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can view commit_branches in their streams" on public.commit_branches;
create policy "Users can view commit_branches in their streams"
on public.commit_branches
for select
using (
  exists (
    select 1
    from public.entries e
    join public.streams s on s.id = e.stream_id
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where e.id = commit_branches.commit_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert commit_branches in their streams" on public.commit_branches;
create policy "Users can insert commit_branches in their streams"
on public.commit_branches
for insert
with check (
  exists (
    select 1
    from public.entries e
    join public.branches b on b.id = commit_branches.branch_id
    join public.streams s on s.id = e.stream_id
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where e.id = commit_branches.commit_id
      and b.stream_id = e.stream_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete commit_branches in their streams" on public.commit_branches;
create policy "Users can delete commit_branches in their streams"
on public.commit_branches
for delete
using (
  exists (
    select 1
    from public.entries e
    join public.streams s on s.id = e.stream_id
    join public.cabinets c on c.id = s.cabinet_id
    join public.domains d on d.id = c.domain_id
    where e.id = commit_branches.commit_id
      and d.user_id = auth.uid()
  )
);

grant all on table public.branches to anon;
grant all on table public.branches to authenticated;
grant all on table public.branches to service_role;

grant all on table public.commit_branches to anon;
grant all on table public.commit_branches to authenticated;
grant all on table public.commit_branches to service_role;