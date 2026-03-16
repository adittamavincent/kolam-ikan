alter table public.documents
  add column if not exists thumbnail_status text not null default 'pending'
    check (thumbnail_status in ('pending', 'processing', 'ready', 'failed', 'unsupported')),
  add column if not exists thumbnail_error text null,
  add column if not exists thumbnail_updated_at timestamptz null;

create index if not exists idx_documents_thumbnail_status on public.documents(thumbnail_status);

update public.documents
set thumbnail_status = 'ready',
    thumbnail_updated_at = now()
where thumbnail_path is not null
  and thumbnail_status = 'pending';
