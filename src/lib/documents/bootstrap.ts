import { createAdminClient } from '@/lib/supabase/admin';

const DOCUMENT_SCHEMA_BOOTSTRAP_SQL = `
create or replace function public.user_can_access_stream(p_stream_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.streams s
    join public.domains d on d.id = s.domain_id
    where s.id = p_stream_id
      and s.deleted_at is null
      and d.deleted_at is null
      and d.user_id = auth.uid()
  );
$$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  created_by uuid null default auth.uid(),
  title text not null,
  original_filename text not null,
  content_type text not null,
  file_size_bytes bigint null,
  storage_bucket text not null default 'document-files',
  storage_path text not null,
  import_status text not null default 'queued' check (import_status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
  source_metadata jsonb not null default '{}'::jsonb,
  extracted_markdown text null,
  extraction_metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_import_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  created_by uuid null default auth.uid(),
  provider text not null default 'docling',
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
  progress_percent integer null check (progress_percent is null or (progress_percent >= 0 and progress_percent <= 100)),
  progress_message text null,
  eta_seconds integer null check (eta_seconds is null or eta_seconds >= 0),
  parser_config jsonb not null default '{}'::jsonb,
  warning_messages jsonb not null default '[]'::jsonb,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_import_jobs
  add column if not exists progress_percent integer null;
alter table public.document_import_jobs
  add column if not exists progress_message text null;
alter table public.document_import_jobs
  add column if not exists eta_seconds integer null;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  chunk_index integer not null,
  token_count integer null,
  page_start integer null,
  page_end integer null,
  heading_path jsonb not null default '[]'::jsonb,
  chunk_markdown text not null,
  chunk_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists public.document_entry_links (
  document_id uuid not null references public.documents(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  relationship_type text not null default 'source' check (relationship_type in ('source', 'derived_from', 'reference')),
  created_at timestamptz not null default now(),
  primary key (document_id, entry_id)
);

create index if not exists idx_documents_stream_id_created_at on public.documents(stream_id, created_at desc);
create index if not exists idx_documents_import_status on public.documents(import_status);
create index if not exists idx_document_import_jobs_document_id_created_at on public.document_import_jobs(document_id, created_at desc);
create index if not exists idx_document_import_jobs_stream_id_status on public.document_import_jobs(stream_id, status);
create index if not exists idx_document_chunks_document_id_chunk_index on public.document_chunks(document_id, chunk_index);
create index if not exists idx_document_entry_links_entry_id on public.document_entry_links(entry_id);

drop trigger if exists update_documents_updated_at on public.documents;
create trigger update_documents_updated_at
before update on public.documents
for each row
execute function public.update_updated_at_column();

drop trigger if exists update_document_import_jobs_updated_at on public.document_import_jobs;
create trigger update_document_import_jobs_updated_at
before update on public.document_import_jobs
for each row
execute function public.update_updated_at_column();

alter table public.documents enable row level security;
alter table public.document_import_jobs enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_entry_links enable row level security;

drop policy if exists "No hard deletes on documents" on public.documents;
create policy "No hard deletes on documents"
on public.documents
for delete
using (false);

drop policy if exists "Users can view documents in their streams" on public.documents;
create policy "Users can view documents in their streams"
on public.documents
for select
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can insert documents in their streams" on public.documents;
create policy "Users can insert documents in their streams"
on public.documents
for insert
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can update documents in their streams" on public.documents;
create policy "Users can update documents in their streams"
on public.documents
for update
using (public.user_can_access_stream(stream_id))
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can view document jobs in their streams" on public.document_import_jobs;
create policy "Users can view document jobs in their streams"
on public.document_import_jobs
for select
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can insert document jobs in their streams" on public.document_import_jobs;
create policy "Users can insert document jobs in their streams"
on public.document_import_jobs
for insert
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can update document jobs in their streams" on public.document_import_jobs;
create policy "Users can update document jobs in their streams"
on public.document_import_jobs
for update
using (public.user_can_access_stream(stream_id))
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can delete document jobs in their streams" on public.document_import_jobs;
create policy "Users can delete document jobs in their streams"
on public.document_import_jobs
for delete
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can view document chunks in their streams" on public.document_chunks;
create policy "Users can view document chunks in their streams"
on public.document_chunks
for select
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can insert document chunks in their streams" on public.document_chunks;
create policy "Users can insert document chunks in their streams"
on public.document_chunks
for insert
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can update document chunks in their streams" on public.document_chunks;
create policy "Users can update document chunks in their streams"
on public.document_chunks
for update
using (public.user_can_access_stream(stream_id))
with check (public.user_can_access_stream(stream_id));

drop policy if exists "Users can delete document chunks in their streams" on public.document_chunks;
create policy "Users can delete document chunks in their streams"
on public.document_chunks
for delete
using (public.user_can_access_stream(stream_id));

drop policy if exists "Users can view document links in their streams" on public.document_entry_links;
create policy "Users can view document links in their streams"
on public.document_entry_links
for select
using (
  exists (
    select 1
    from public.documents d
    where d.id = document_entry_links.document_id
      and public.user_can_access_stream(d.stream_id)
  )
);

drop policy if exists "Users can insert document links in their streams" on public.document_entry_links;
create policy "Users can insert document links in their streams"
on public.document_entry_links
for insert
with check (
  exists (
    select 1
    from public.documents d
    join public.entries e on e.id = document_entry_links.entry_id
    where d.id = document_entry_links.document_id
      and e.stream_id = d.stream_id
      and public.user_can_access_stream(d.stream_id)
  )
);

drop policy if exists "Users can delete document links in their streams" on public.document_entry_links;
create policy "Users can delete document links in their streams"
on public.document_entry_links
for delete
using (
  exists (
    select 1
    from public.documents d
    where d.id = document_entry_links.document_id
      and public.user_can_access_stream(d.stream_id)
  )
);

grant all on function public.user_can_access_stream(uuid) to anon;
grant all on function public.user_can_access_stream(uuid) to authenticated;
grant all on function public.user_can_access_stream(uuid) to service_role;

grant all on table public.documents to anon;
grant all on table public.documents to authenticated;
grant all on table public.documents to service_role;

grant all on table public.document_import_jobs to anon;
grant all on table public.document_import_jobs to authenticated;
grant all on table public.document_import_jobs to service_role;

grant all on table public.document_chunks to anon;
grant all on table public.document_chunks to authenticated;
grant all on table public.document_chunks to service_role;

grant all on table public.document_entry_links to anon;
grant all on table public.document_entry_links to authenticated;
grant all on table public.document_entry_links to service_role;
`;

export function isMissingDocumentSchemaError(message?: string | null) {
  const text = (message ?? '').toLowerCase();
  return text.includes("could not find the table 'public.documents'")
    || text.includes("could not find the table 'public.document_import_jobs'")
    || text.includes("could not find the 'eta_seconds' column")
    || text.includes("could not find the 'progress_percent' column")
    || text.includes("could not find the 'progress_message' column")
    || text.includes('relation "public.documents" does not exist')
    || text.includes('relation "public.document_import_jobs" does not exist')
    || text.includes('column "eta_seconds" does not exist')
    || text.includes('column "progress_percent" does not exist')
    || text.includes('column "progress_message" does not exist')
    || text.includes('schema cache');
}

export async function ensureDocumentSchema() {
  const admin = createAdminClient();
  const { error } = await admin.rpc('exec_sql', { sql: DOCUMENT_SCHEMA_BOOTSTRAP_SQL });

  if (error) {
    throw error;
  }
}
