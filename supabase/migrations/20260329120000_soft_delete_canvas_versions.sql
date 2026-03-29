alter table public.canvas_versions
add column if not exists deleted_at timestamptz;

create index if not exists idx_canvas_versions_stream_id_active
on public.canvas_versions(stream_id, created_at desc)
where deleted_at is null;

drop policy if exists "No hard deletes on canvas_versions" on public.canvas_versions;
create policy "No hard deletes on canvas_versions"
on public.canvas_versions
for delete
using (false);

drop policy if exists "Users can update canvas versions in their streams" on public.canvas_versions;
create policy "Users can update canvas versions in their streams"
on public.canvas_versions
for update
using (public.user_can_access_stream(stream_id))
with check (public.user_can_access_stream(stream_id));
