drop policy if exists "Users can view branches in their streams" on public.branches;
create policy "Users can view branches in their streams"
on public.branches
for select
using (
  exists (
    select 1
    from public.streams s
    join public.domains d on d.id = s.domain_id
    where s.id = branches.stream_id
      and s.deleted_at is null
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
    join public.domains d on d.id = s.domain_id
    where s.id = branches.stream_id
      and s.deleted_at is null
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
    join public.domains d on d.id = s.domain_id
    where s.id = branches.stream_id
      and s.deleted_at is null
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.streams s
    join public.domains d on d.id = s.domain_id
    where s.id = branches.stream_id
      and s.deleted_at is null
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
    join public.domains d on d.id = s.domain_id
    where e.id = commit_branches.commit_id
      and s.deleted_at is null
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
    join public.domains d on d.id = s.domain_id
    where e.id = commit_branches.commit_id
      and b.stream_id = e.stream_id
      and s.deleted_at is null
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
    join public.domains d on d.id = s.domain_id
    where e.id = commit_branches.commit_id
      and s.deleted_at is null
      and d.user_id = auth.uid()
  )
);
