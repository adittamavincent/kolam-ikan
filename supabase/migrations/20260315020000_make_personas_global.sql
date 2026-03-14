-- Remove stream and document columns from personas
alter table public.personas
  drop constraint if exists personas_shadow_scope_check;

alter table public.personas
  drop column if exists shadow_stream_id cascade,
  drop column if exists shadow_document_id cascade;

drop index if exists public.idx_personas_user_shadow_stream;
drop index if exists public.idx_personas_shadow_document;
drop index if exists public.idx_unique_active_persona_name_by_scope;

-- Deduplicate personas by (user_id, name)
do $$
declare
  dup_record record;
  primary_id uuid;
begin
  for dup_record in
    select user_id, name, array_agg(id order by created_at asc) as ids
    from public.personas
    where deleted_at is null
    group by user_id, name
    having count(*) > 1
  loop
    primary_id := dup_record.ids[1];
    -- Repoint sections to the primary persona
    update public.sections
    set persona_id = primary_id
    where persona_id = any(dup_record.ids[2:array_length(dup_record.ids, 1)]);
    
    update public.section_pdf_attachments
    set referenced_persona_id = primary_id
    where referenced_persona_id = any(dup_record.ids[2:array_length(dup_record.ids, 1)]);

    -- Hard delete duplicate personas
    delete from public.personas
    where id = any(dup_record.ids[2:array_length(dup_record.ids, 1)]);
  end loop;
end;
$$ language plpgsql;

-- Make persona unique by name and user_id globally
create unique index if not exists idx_unique_active_persona_name_global
  on public.personas (user_id, name)
  where deleted_at is null;
