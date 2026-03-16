select id, thumbnail_status, thumbnail_path
from public.documents
order by created_at desc
limit 5;