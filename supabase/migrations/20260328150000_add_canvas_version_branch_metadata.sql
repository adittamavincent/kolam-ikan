alter table public.canvas_versions
add column if not exists branch_name text,
add column if not exists source_entry_id uuid references public.entries(id) on delete set null;

create index if not exists idx_canvas_versions_branch_name
on public.canvas_versions(branch_name);

create index if not exists idx_canvas_versions_source_entry_id
on public.canvas_versions(source_entry_id);

-- Backfill source_entry_id for historical snapshots so branch filtering can
-- infer lineage without requiring manual re-save.
update public.canvas_versions cv
set source_entry_id = (
  select en.id
  from public.entries en
  where en.stream_id = cv.stream_id
    and en.is_draft = false
    and en.deleted_at is null
    and en.created_at <= coalesce(cv.created_at, now())
  order by en.created_at desc nulls last, en.id desc
  limit 1
)
where cv.source_entry_id is null;
