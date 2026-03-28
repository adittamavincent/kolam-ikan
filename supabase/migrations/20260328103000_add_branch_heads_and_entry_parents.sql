alter table public.entries
add column if not exists parent_commit_id uuid references public.entries(id) on delete set null;

alter table public.branches
add column if not exists head_commit_id uuid references public.entries(id) on delete set null;

create index if not exists idx_entries_parent_commit_id
on public.entries(parent_commit_id);

create index if not exists idx_branches_head_commit_id
on public.branches(head_commit_id);

with ordered_entries as (
  select
    id,
    stream_id,
    lag(id) over (
      partition by stream_id
      order by created_at asc nulls last, id asc
    ) as previous_entry_id
  from public.entries
  where is_draft = false
    and deleted_at is null
)
update public.entries as e
set parent_commit_id = ordered_entries.previous_entry_id
from ordered_entries
where e.id = ordered_entries.id
  and e.parent_commit_id is null;

with branch_heads as (
  select distinct on (cb.branch_id)
    cb.branch_id,
    cb.commit_id
  from public.commit_branches cb
  join public.entries e on e.id = cb.commit_id
  where e.deleted_at is null
    and e.is_draft = false
  order by cb.branch_id, e.created_at desc nulls last, e.id desc
)
update public.branches as b
set head_commit_id = branch_heads.commit_id
from branch_heads
where b.id = branch_heads.branch_id
  and b.head_commit_id is null;

insert into public.branches (stream_id, name, head_commit_id)
select
  s.id,
  'main',
  latest_entry.id
from public.streams s
left join lateral (
  select e.id
  from public.entries e
  where e.stream_id = s.id
    and e.deleted_at is null
    and e.is_draft = false
  order by e.created_at desc nulls last, e.id desc
  limit 1
) as latest_entry on true
where not exists (
  select 1
  from public.branches b
  where b.stream_id = s.id
    and b.name = 'main'
);
