UPDATE public.streams
SET
  name = 'Welcome',
  updated_at = NOW()
WHERE deleted_at IS NULL
  AND stream_kind = 'GLOBAL'
  AND name = 'Global User Entry';

CREATE OR REPLACE FUNCTION public.create_global_stream_for_new_domain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.streams (
    domain_id,
    cabinet_id,
    name,
    sort_order,
    stream_kind
  ) VALUES (
    NEW.id,
    NULL,
    'Welcome',
    -100,
    'GLOBAL'
  )
  ON CONFLICT (domain_id)
  WHERE (stream_kind = 'GLOBAL' AND deleted_at IS NULL)
  DO NOTHING;

  RETURN NEW;
END;
$$;
