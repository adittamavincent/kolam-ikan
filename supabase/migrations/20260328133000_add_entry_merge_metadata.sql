alter table public.entries
add column if not exists entry_kind text not null default 'commit',
add column if not exists merge_source_commit_id uuid references public.entries(id) on delete set null,
add column if not exists merge_source_branch_name text,
add column if not exists merge_target_branch_name text;

create index if not exists idx_entries_merge_source_commit_id
on public.entries(merge_source_commit_id);
