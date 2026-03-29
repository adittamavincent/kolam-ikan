alter table public.audit_logs enable row level security;
alter table public.canvas_versions enable row level security;

drop policy if exists "Users can view their own audit logs" on public.audit_logs;
create policy "Users can view their own audit logs"
on public.audit_logs
for select
using (user_id = auth.uid());

drop policy if exists "Users can insert their own audit logs" on public.audit_logs;
create policy "Users can insert their own audit logs"
on public.audit_logs
for insert
with check (user_id = auth.uid());

drop policy if exists "No hard deletes on audit_logs" on public.audit_logs;
create policy "No hard deletes on audit_logs"
on public.audit_logs
for delete
using (false);

drop policy if exists "Users can view canvas versions in their streams" on public.canvas_versions;
create policy "Users can view canvas versions in their streams"
on public.canvas_versions
for select
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can insert canvas versions in their streams" on public.canvas_versions;
create policy "Users can insert canvas versions in their streams"
on public.canvas_versions
for insert
with check (public.user_can_access_stream(stream_id));

drop policy if exists "No hard deletes on canvas_versions" on public.canvas_versions;
create policy "No hard deletes on canvas_versions"
on public.canvas_versions
for delete
using (false);

alter function if exists public.update_updated_at_column()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.create_global_stream_for_new_domain()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.enforce_system_global_stream_rules()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.cleanup_shadow_persona_from_attachments()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.user_can_access_stream(uuid)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.cleanup_shadow_persona_from_sections()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.cleanup_unused_shadow_persona(uuid)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.apply_audit_inverse(text, uuid, jsonb)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.create_canvas_for_new_stream()
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.create_entry_with_section(uuid, jsonb, uuid, text)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.create_entry_with_section(uuid, jsonb, uuid, text, boolean)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.get_domain_stats(uuid)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.jsonb_to_text(jsonb)
  set search_path = public, auth, extensions, pg_temp;

alter function if exists public.revert_bridge_action(uuid)
  set search_path = public, auth, extensions, pg_temp;
