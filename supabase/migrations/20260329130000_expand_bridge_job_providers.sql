alter table public.bridge_jobs
drop constraint if exists bridge_jobs_provider_check;

alter table public.bridge_jobs
add constraint bridge_jobs_provider_check
check (provider in ('chatgpt', 'gemini', 'claude'));
