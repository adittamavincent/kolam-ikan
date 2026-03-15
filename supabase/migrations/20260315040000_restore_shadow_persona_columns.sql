-- Restore shadow persona columns and scoped uniqueness for WhatsApp import shadow personas

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
  drop constraint if exists personas_shadow_scope_check;

alter table public.personas
  add constraint personas_shadow_scope_check
  check (
    (is_shadow = false and shadow_stream_id is null and shadow_document_id is null)
    or (is_shadow = true and (shadow_stream_id is not null or shadow_document_id is not null))
  );

-- Replace global uniqueness with scoped uniqueness
DROP INDEX IF EXISTS public.idx_unique_active_persona_name_global;

create unique index if not exists idx_unique_active_persona_name_by_scope
  on public.personas (
    user_id,
    name,
    coalesce(is_shadow, false),
    coalesce(shadow_stream_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(shadow_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where deleted_at is null;
