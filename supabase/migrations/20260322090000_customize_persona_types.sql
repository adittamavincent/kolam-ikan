alter table public.personas
  drop constraint if exists personas_type_check;

alter table public.personas
  add constraint personas_type_check
  check (char_length(btrim(type)) > 0);

drop policy if exists "Users can insert their own personas" on public.personas;
create policy "Users can insert their own personas"
  on public.personas
  for insert
  with check (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
    and char_length(btrim(type)) > 0
  );

drop policy if exists "Users can soft-delete (update deleted_at) their own personas" on public.personas;
create policy "Users can soft-delete (update deleted_at) their own personas"
  on public.personas
  for update
  using (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
  )
  with check (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
    and char_length(btrim(type)) > 0
  );

drop policy if exists "Users can update their own personas" on public.personas;
create policy "Users can update their own personas"
  on public.personas
  for update
  using (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
  )
  with check (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
    and char_length(btrim(type)) > 0
  );

drop policy if exists "Users can hard-delete their own personas" on public.personas;
create policy "Users can hard-delete their own personas"
  on public.personas
  for delete
  using (
    user_id = auth.uid()
    and coalesce(is_system, false) = false
  );

drop policy if exists "Users can view their own personas and system AI personas" on public.personas;
create policy "Users can view their own personas and system personas"
  on public.personas
  for select
  using (
    user_id = auth.uid()
    or coalesce(is_system, false) = true
  );
