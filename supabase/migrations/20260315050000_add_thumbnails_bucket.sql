insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Thumbnails are publicly accessible" on storage.objects;
create policy "Thumbnails are publicly accessible"
on storage.objects for select
using ( bucket_id = 'thumbnails' );

drop policy if exists "Users can upload thumbnails" on storage.objects;
create policy "Users can upload thumbnails"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'thumbnails' );
