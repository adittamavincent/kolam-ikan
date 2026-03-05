-- Create exec_sql function for seeding
create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    execute sql;
end;
$$;
