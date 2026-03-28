create table if not exists public.user_ui_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger update_user_ui_preferences_updated_at
before update on public.user_ui_preferences
for each row
execute function public.update_updated_at_column();

alter table public.user_ui_preferences enable row level security;

drop policy if exists "No hard deletes on user_ui_preferences" on public.user_ui_preferences;
create policy "No hard deletes on user_ui_preferences"
on public.user_ui_preferences
for delete
using (false);

drop policy if exists "Users can view their own UI preferences" on public.user_ui_preferences;
create policy "Users can view their own UI preferences"
on public.user_ui_preferences
for select
using (user_id = auth.uid());

drop policy if exists "Users can insert their own UI preferences" on public.user_ui_preferences;
create policy "Users can insert their own UI preferences"
on public.user_ui_preferences
for insert
with check (user_id = auth.uid());

drop policy if exists "Users can update their own UI preferences" on public.user_ui_preferences;
create policy "Users can update their own UI preferences"
on public.user_ui_preferences
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
