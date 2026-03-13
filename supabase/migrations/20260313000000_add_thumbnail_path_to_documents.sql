-- Add thumbnail_path column to documents table for storing generated thumbnail paths
alter table public.documents
  add column if not exists thumbnail_path text null;

-- Add index for efficient thumbnail lookups
create index if not exists idx_documents_thumbnail_path on public.documents(thumbnail_path) where thumbnail_path is not null;

-- Add comment for documentation
comment on column public.documents.thumbnail_path is 'Path to the generated thumbnail image in the thumbnails storage bucket';