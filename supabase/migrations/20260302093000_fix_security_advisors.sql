-- Fix Supabase security advisor warnings:
-- 1) Set an explicit search_path for flagged public functions.
-- 2) Move pg_trgm extension from public schema to extensions schema.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'
      AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;


DO $$
DECLARE
  fn_signature regprocedure;
BEGIN
  FOR fn_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (
        ARRAY[
          'set_updated_at',
          'make_content_tsvector',
          'entries_content_text_trigger',
          'canvases_content_text_trigger',
          'handle_new_user'
        ]
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, extensions;',
      fn_signature
    );
  END LOOP;
END $$;