update public.documents
set thumbnail_status = 'pending',
    thumbnail_error = null,
    thumbnail_updated_at = now()
where thumbnail_path is null;
