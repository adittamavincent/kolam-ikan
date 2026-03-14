drop policy if exists "Users can view stream documents bucket objects" on storage.objects;
create policy "Users can view stream or user documents bucket objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'document-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.user_can_access_stream(((storage.foldername(name))[1])::uuid)
    )
  )
);

drop policy if exists "Users can upload stream documents bucket objects" on storage.objects;
create policy "Users can upload stream or user documents bucket objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'document-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.user_can_access_stream(((storage.foldername(name))[1])::uuid)
    )
  )
);

drop policy if exists "Users can update stream documents bucket objects" on storage.objects;
create policy "Users can update stream or user documents bucket objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'document-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.user_can_access_stream(((storage.foldername(name))[1])::uuid)
    )
  )
)
with check (
  bucket_id = 'document-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.user_can_access_stream(((storage.foldername(name))[1])::uuid)
    )
  )
);

drop policy if exists "Users can delete stream documents bucket objects" on storage.objects;
create policy "Users can delete stream or user documents bucket objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'document-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and public.user_can_access_stream(((storage.foldername(name))[1])::uuid)
    )
  )
);
