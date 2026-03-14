alter table public.personas
  add column if not exists is_shadow boolean not null default false,
  add column if not exists shadow_stream_id uuid null references public.streams(id) on delete cascade,
  add column if not exists shadow_document_id uuid null references public.documents(id) on delete cascade;

create index if not exists idx_personas_user_shadow_stream
  on public.personas(user_id, is_shadow, shadow_stream_id);

create index if not exists idx_personas_shadow_document
  on public.personas(shadow_document_id)
  where shadow_document_id is not null;

alter table public.personas
  add constraint personas_shadow_scope_check
  check (
    (is_shadow = false and shadow_stream_id is null and shadow_document_id is null)
    or (is_shadow = true and (shadow_stream_id is not null or shadow_document_id is not null))
  );
