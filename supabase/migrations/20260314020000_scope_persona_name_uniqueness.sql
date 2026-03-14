drop index if exists public.idx_unique_active_persona_name;

create unique index if not exists idx_unique_active_persona_name_by_scope
  on public.personas (
    user_id,
    name,
    coalesce(is_shadow, false),
    coalesce(shadow_stream_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(shadow_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where deleted_at is null;
