create or replace function public.prevent_deleting_in_use_documents()
returns trigger
language plpgsql
as $$
declare
  attachment_count integer;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    select count(*)
    into attachment_count
    from public.section_attachments
    where document_id = new.id;

    if attachment_count > 0 then
      raise exception
        'Cannot delete a document while it is still attached to one or more sections (% references)',
        attachment_count;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_deleting_in_use_documents on public.documents;
create trigger prevent_deleting_in_use_documents
before update on public.documents
for each row
execute function public.prevent_deleting_in_use_documents();
