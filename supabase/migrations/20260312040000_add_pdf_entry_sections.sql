alter table public.sections
  add column if not exists section_type text not null default 'PERSONA'
    check (section_type in ('PERSONA', 'PDF'));

alter table public.sections
  add column if not exists pdf_display_mode text not null default 'inline'
    check (pdf_display_mode in ('inline', 'download', 'external'));

alter table public.sections
  alter column persona_id drop not null;

create table if not exists public.section_pdf_attachments (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  sort_order integer not null default 0,
  title_snapshot text null,
  annotation_text text null,
  referenced_persona_id uuid null references public.personas(id) on delete set null,
  referenced_page integer null check (referenced_page is null or referenced_page > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, document_id)
);

create index if not exists idx_sections_entry_type_sort on public.sections(entry_id, section_type, sort_order);
create index if not exists idx_section_pdf_attachments_section_sort on public.section_pdf_attachments(section_id, sort_order);
create index if not exists idx_section_pdf_attachments_document on public.section_pdf_attachments(document_id);

create or replace trigger update_section_pdf_attachments_updated_at
before update on public.section_pdf_attachments
for each row
execute function public.update_updated_at_column();

alter table public.section_pdf_attachments enable row level security;

drop policy if exists "Users can view section pdf attachments in their streams" on public.section_pdf_attachments;
create policy "Users can view section pdf attachments in their streams"
on public.section_pdf_attachments
for select
using (
  exists (
    select 1
    from public.sections s
    join public.entries e on e.id = s.entry_id
    where s.id = section_pdf_attachments.section_id
      and public.user_can_access_stream(e.stream_id)
  )
);

drop policy if exists "Users can insert section pdf attachments in their streams" on public.section_pdf_attachments;
create policy "Users can insert section pdf attachments in their streams"
on public.section_pdf_attachments
for insert
with check (
  exists (
    select 1
    from public.sections s
    join public.entries e on e.id = s.entry_id
    join public.documents d on d.id = section_pdf_attachments.document_id
    where s.id = section_pdf_attachments.section_id
      and d.stream_id = e.stream_id
      and public.user_can_access_stream(e.stream_id)
  )
);

drop policy if exists "Users can update section pdf attachments in their streams" on public.section_pdf_attachments;
create policy "Users can update section pdf attachments in their streams"
on public.section_pdf_attachments
for update
using (
  exists (
    select 1
    from public.sections s
    join public.entries e on e.id = s.entry_id
    where s.id = section_pdf_attachments.section_id
      and public.user_can_access_stream(e.stream_id)
  )
)
with check (
  exists (
    select 1
    from public.sections s
    join public.entries e on e.id = s.entry_id
    join public.documents d on d.id = section_pdf_attachments.document_id
    where s.id = section_pdf_attachments.section_id
      and d.stream_id = e.stream_id
      and public.user_can_access_stream(e.stream_id)
  )
);

drop policy if exists "Users can delete section pdf attachments in their streams" on public.section_pdf_attachments;
create policy "Users can delete section pdf attachments in their streams"
on public.section_pdf_attachments
for delete
using (
  exists (
    select 1
    from public.sections s
    join public.entries e on e.id = s.entry_id
    where s.id = section_pdf_attachments.section_id
      and public.user_can_access_stream(e.stream_id)
  )
);

grant all on table public.section_pdf_attachments to anon;
grant all on table public.section_pdf_attachments to authenticated;
grant all on table public.section_pdf_attachments to service_role;
