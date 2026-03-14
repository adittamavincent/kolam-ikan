-- Drop the existing global index
drop index if exists public.idx_unique_active_persona_name_global;

-- Re-create index to allow same name as long as one is shadow and the other is user-created
create unique index if not exists idx_unique_active_persona_name_global
  on public.personas (user_id, name, coalesce(is_shadow, false))
  where deleted_at is null;
