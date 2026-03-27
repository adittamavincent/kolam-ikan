-- Introduce markdown-first storage for editable stream content while keeping
-- BlockNote JSON as a derived cache for the current editor implementation.

CREATE OR REPLACE FUNCTION public.markdown_to_search_text(markdown text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      COALESCE(markdown, ''),
      '<[^>]+>',
      '',
      'g'
    )
  );
$$;

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS raw_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown+blocknote-v1';

ALTER TABLE public.canvases
  ADD COLUMN IF NOT EXISTS raw_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown+blocknote-v1';

ALTER TABLE public.canvas_versions
  ADD COLUMN IF NOT EXISTS raw_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown+blocknote-v1';

UPDATE public.sections
SET
  raw_markdown = COALESCE(NULLIF(raw_markdown, ''), public.jsonb_to_text(content_json)),
  content_format = COALESCE(NULLIF(content_format, ''), 'markdown+blocknote-v1')
WHERE raw_markdown = ''
   OR content_format = '';

UPDATE public.canvases
SET
  raw_markdown = COALESCE(NULLIF(raw_markdown, ''), public.jsonb_to_text(content_json)),
  content_format = COALESCE(NULLIF(content_format, ''), 'markdown+blocknote-v1')
WHERE raw_markdown = ''
   OR content_format = '';

UPDATE public.canvas_versions
SET
  raw_markdown = COALESCE(NULLIF(raw_markdown, ''), public.jsonb_to_text(content_json)),
  content_format = COALESCE(NULLIF(content_format, ''), 'markdown+blocknote-v1')
WHERE raw_markdown = ''
   OR content_format = '';

DROP INDEX IF EXISTS public.idx_sections_search_text;
DROP INDEX IF EXISTS public.idx_sections_search_text_trgm;

ALTER TABLE public.sections
  DROP COLUMN IF EXISTS search_text;

ALTER TABLE public.sections
  ADD COLUMN search_text text GENERATED ALWAYS AS (
    COALESCE(
      NULLIF(public.markdown_to_search_text(raw_markdown), ''),
      public.jsonb_to_text(content_json)
    )
  ) STORED;

CREATE INDEX idx_sections_search_text
  ON public.sections
  USING gin (to_tsvector('english', search_text));

CREATE INDEX idx_sections_search_text_trgm
  ON public.sections
  USING gin (search_text extensions.gin_trgm_ops);

DROP INDEX IF EXISTS public.idx_canvases_content_text_trgm;

CREATE INDEX idx_canvases_content_text_trgm
  ON public.canvases
  USING gin (
    (
      COALESCE(
        NULLIF(public.markdown_to_search_text(raw_markdown), ''),
        public.jsonb_to_text(content_json)
      )
    ) extensions.gin_trgm_ops
  );

CREATE OR REPLACE FUNCTION public.search_canvases(
  p_query text,
  p_limit integer DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  stream_id uuid,
  stream_name text,
  domain_id uuid,
  domain_name text,
  domain_icon text,
  updated_at timestamp with time zone,
  content_preview text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    s.id AS stream_id,
    s.name AS stream_name,
    d.id AS domain_id,
    d.name AS domain_name,
    d.icon AS domain_icon,
    c.updated_at,
    LEFT(
      COALESCE(
        NULLIF(public.markdown_to_search_text(c.raw_markdown), ''),
        public.jsonb_to_text(c.content_json)
      ),
      140
    ) AS content_preview
  FROM public.canvases c
  JOIN public.streams s
    ON s.id = c.stream_id
   AND s.deleted_at IS NULL
  JOIN public.domains d
    ON d.id = s.domain_id
   AND d.deleted_at IS NULL
  WHERE COALESCE(
    NULLIF(public.markdown_to_search_text(c.raw_markdown), ''),
    public.jsonb_to_text(c.content_json)
  ) ILIKE '%' || COALESCE(p_query, '') || '%'
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 15), 1);
$$;

GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO anon;
GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_audit_inverse(target_table text, target_id uuid, payload jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  op text := payload->>'op';
  before_row jsonb := payload->'before';
  sql text;
BEGIN
  IF op = 'update' THEN
    IF target_table = 'canvases' THEN
      UPDATE public.canvases
      SET
        content_json = before_row->'content_json',
        raw_markdown = COALESCE(before_row->>'raw_markdown', ''),
        content_format = COALESCE(before_row->>'content_format', 'markdown+blocknote-v1'),
        updated_at = NOW()
      WHERE id = target_id;
    ELSIF target_table = 'sections' THEN
      UPDATE public.sections
      SET
        content_json = before_row->'content_json',
        raw_markdown = COALESCE(before_row->>'raw_markdown', ''),
        content_format = COALESCE(before_row->>'content_format', 'markdown+blocknote-v1'),
        persona_id = (before_row->>'persona_id')::uuid,
        persona_name_snapshot = before_row->>'persona_name_snapshot',
        sort_order = COALESCE((before_row->>'sort_order')::integer, sort_order),
        updated_at = NOW()
      WHERE id = target_id;
    ELSE
      RAISE EXCEPTION 'apply_audit_inverse update not implemented for table %', target_table;
    END IF;
  ELSIF op = 'insert' THEN
    sql := format('DELETE FROM %I WHERE id = $1', target_table);
    EXECUTE sql USING target_id;
  ELSIF op = 'delete' THEN
    IF target_table = 'canvases' THEN
      INSERT INTO public.canvases (
        id,
        stream_id,
        content_json,
        raw_markdown,
        content_format,
        created_at,
        updated_at
      )
      VALUES (
        (before_row->>'id')::uuid,
        (before_row->>'stream_id')::uuid,
        before_row->'content_json',
        COALESCE(before_row->>'raw_markdown', ''),
        COALESCE(before_row->>'content_format', 'markdown+blocknote-v1'),
        (before_row->>'created_at')::timestamptz,
        NOW()
      );
    ELSIF target_table = 'sections' THEN
      INSERT INTO public.sections (
        id,
        entry_id,
        persona_id,
        persona_name_snapshot,
        content_json,
        raw_markdown,
        content_format,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (
        (before_row->>'id')::uuid,
        (before_row->>'entry_id')::uuid,
        (before_row->>'persona_id')::uuid,
        before_row->>'persona_name_snapshot',
        before_row->'content_json',
        COALESCE(before_row->>'raw_markdown', ''),
        COALESCE(before_row->>'content_format', 'markdown+blocknote-v1'),
        COALESCE((before_row->>'sort_order')::integer, 0),
        (before_row->>'created_at')::timestamptz,
        NOW()
      );
    ELSIF target_table = 'entries' THEN
      INSERT INTO public.entries (id, stream_id, created_at, updated_at, deleted_at)
      VALUES (
        (before_row->>'id')::uuid,
        (before_row->>'stream_id')::uuid,
        (before_row->>'created_at')::timestamptz,
        NOW(),
        NULL
      );
    ELSE
      RAISE EXCEPTION 'apply_audit_inverse delete restore not implemented for table %', target_table;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown audit op: %', op;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.duplicate_domain(
  p_orig_domain_id uuid,
  p_new_name text,
  p_new_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_domain_id uuid;
  v_new_id uuid;
  v_cab_map jsonb := '{}'::jsonb;
  v_stream_map jsonb := '{}'::jsonb;
  v_entry_map jsonb := '{}'::jsonb;
  v_section_map jsonb := '{}'::jsonb;
  cab RECORD;
  s RECORD;
  e RECORD;
  sec RECORD;
  s_att RECORD;
  del RECORD;
  canvas_row RECORD;
  cv RECORD;
  v_new_cab uuid;
  v_new_stream uuid;
  v_new_entry uuid;
  v_new_section uuid;
  v_target_global_stream uuid;
BEGIN
  INSERT INTO public.domains (id, user_id, name, icon, description, sort_order, settings, created_at, updated_at)
  SELECT extensions.gen_random_uuid(), p_new_user_id, COALESCE(p_new_name, name || ' — copy'), icon, description, sort_order, settings, now(), now()
  FROM public.domains
  WHERE id = p_orig_domain_id
  RETURNING id INTO v_new_domain_id;

  IF v_new_domain_id IS NULL THEN
    RAISE EXCEPTION 'original domain not found: %', p_orig_domain_id;
  END IF;

  FOR cab IN
    SELECT id, parent_id, name, sort_order
    FROM public.cabinets
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
  LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO public.cabinets (id, domain_id, parent_id, name, sort_order, created_at, updated_at)
    VALUES (v_new_id, v_new_domain_id, NULL, cab.name, cab.sort_order, now(), now());
    v_cab_map := v_cab_map || jsonb_build_object(cab.id::text, v_new_id::text);
  END LOOP;

  FOR cab IN
    SELECT id, parent_id
    FROM public.cabinets
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
      AND parent_id IS NOT NULL
  LOOP
    UPDATE public.cabinets
    SET parent_id = (v_cab_map ->> cab.parent_id::text)::uuid
    WHERE id = (v_cab_map ->> cab.id::text)::uuid;
  END LOOP;

  SELECT id
  INTO v_target_global_stream
  FROM public.streams
  WHERE domain_id = v_new_domain_id
    AND stream_kind = 'GLOBAL'
    AND deleted_at IS NULL
  LIMIT 1;

  FOR s IN
    SELECT id, cabinet_id, name, sort_order, stream_kind
    FROM public.streams
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
  LOOP
    IF s.stream_kind = 'GLOBAL' THEN
      IF v_target_global_stream IS NULL THEN
        RAISE EXCEPTION 'target global stream not found for duplicated domain: %', v_new_domain_id;
      END IF;

      UPDATE public.streams
      SET name = s.name,
          sort_order = s.sort_order,
          updated_at = now()
      WHERE id = v_target_global_stream;

      v_stream_map := v_stream_map || jsonb_build_object(s.id::text, v_target_global_stream::text);
      CONTINUE;
    END IF;

    v_new_stream := extensions.gen_random_uuid();
    v_new_cab := CASE
      WHEN s.cabinet_id IS NULL THEN NULL
      ELSE (v_cab_map ->> s.cabinet_id::text)::uuid
    END;

    INSERT INTO public.streams (id, cabinet_id, name, sort_order, created_at, updated_at, deleted_at, domain_id, stream_kind)
    VALUES (v_new_stream, v_new_cab, s.name, s.sort_order, now(), now(), NULL, v_new_domain_id, s.stream_kind);

    v_stream_map := v_stream_map || jsonb_build_object(s.id::text, v_new_stream::text);
  END LOOP;

  FOR e IN
    SELECT id, stream_id, is_draft
    FROM public.entries
    WHERE stream_id IN (
      SELECT id
      FROM public.streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
      AND deleted_at IS NULL
  LOOP
    v_new_stream := (v_stream_map ->> e.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    v_new_entry := extensions.gen_random_uuid();
    INSERT INTO public.entries (id, stream_id, created_at, updated_at, deleted_at, is_draft)
    VALUES (v_new_entry, v_new_stream, now(), now(), NULL, e.is_draft);
    v_entry_map := v_entry_map || jsonb_build_object(e.id::text, v_new_entry::text);
  END LOOP;

  FOR sec IN
    SELECT *
    FROM public.sections
    WHERE entry_id IN (
      SELECT id
      FROM public.entries
      WHERE stream_id IN (
        SELECT id
        FROM public.streams
        WHERE domain_id = p_orig_domain_id
          AND deleted_at IS NULL
      )
        AND deleted_at IS NULL
    )
  LOOP
    v_new_entry := (v_entry_map ->> sec.entry_id::text)::uuid;
    IF v_new_entry IS NULL THEN
      CONTINUE;
    END IF;

    v_new_section := extensions.gen_random_uuid();
    INSERT INTO public.sections (
      id,
      entry_id,
      persona_id,
      persona_name_snapshot,
      content_json,
      raw_markdown,
      content_format,
      sort_order,
      section_type,
      file_display_mode,
      created_at,
      updated_at
    )
    VALUES (
      v_new_section,
      v_new_entry,
      sec.persona_id,
      sec.persona_name_snapshot,
      sec.content_json,
      sec.raw_markdown,
      COALESCE(sec.content_format, 'markdown+blocknote-v1'),
      sec.sort_order,
      sec.section_type,
      sec.file_display_mode,
      now(),
      now()
    );
    v_section_map := v_section_map || jsonb_build_object(sec.id::text, v_new_section::text);
  END LOOP;

  FOR s_att IN
    SELECT *
    FROM public.section_attachments
    WHERE section_id IN (
      SELECT id
      FROM public.sections
      WHERE entry_id IN (
        SELECT id
        FROM public.entries
        WHERE stream_id IN (
          SELECT id
          FROM public.streams
          WHERE domain_id = p_orig_domain_id
            AND deleted_at IS NULL
        )
          AND deleted_at IS NULL
      )
    )
  LOOP
    v_new_section := (v_section_map ->> s_att.section_id::text)::uuid;
    IF v_new_section IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.section_attachments (id, section_id, document_id, sort_order, title_snapshot, annotation_text, referenced_persona_id, referenced_page, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      v_new_section,
      s_att.document_id,
      s_att.sort_order,
      s_att.title_snapshot,
      s_att.annotation_text,
      s_att.referenced_persona_id,
      s_att.referenced_page,
      now(),
      now()
    );
  END LOOP;

  FOR del IN
    SELECT *
    FROM public.document_entry_links
    WHERE entry_id IN (
      SELECT id
      FROM public.entries
      WHERE stream_id IN (
        SELECT id
        FROM public.streams
        WHERE domain_id = p_orig_domain_id
          AND deleted_at IS NULL
      )
        AND deleted_at IS NULL
    )
  LOOP
    v_new_entry := (v_entry_map ->> del.entry_id::text)::uuid;
    IF v_new_entry IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.document_entry_links (document_id, entry_id, relationship_type, created_at)
    VALUES (del.document_id, v_new_entry, del.relationship_type, now());
  END LOOP;

  FOR canvas_row IN
    SELECT *
    FROM public.canvases
    WHERE stream_id IN (
      SELECT id
      FROM public.streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
  LOOP
    v_new_stream := (v_stream_map ->> canvas_row.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.canvases (
      id,
      stream_id,
      content_json,
      raw_markdown,
      content_format,
      created_at,
      updated_at
    )
    VALUES (
      extensions.gen_random_uuid(),
      v_new_stream,
      canvas_row.content_json,
      canvas_row.raw_markdown,
      COALESCE(canvas_row.content_format, 'markdown+blocknote-v1'),
      now(),
      now()
    )
    ON CONFLICT (stream_id)
    DO UPDATE SET
      content_json = EXCLUDED.content_json,
      raw_markdown = EXCLUDED.raw_markdown,
      content_format = EXCLUDED.content_format,
      updated_at = now();
  END LOOP;

  FOR cv IN
    SELECT stream_id, content_json, raw_markdown, content_format, name, summary, created_by, created_at
    FROM public.canvas_versions
    WHERE stream_id IN (
      SELECT id
      FROM public.streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
    ORDER BY created_at ASC NULLS LAST
  LOOP
    v_new_stream := (v_stream_map ->> cv.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.canvas_versions (
      id,
      canvas_id,
      stream_id,
      content_json,
      raw_markdown,
      content_format,
      name,
      summary,
      created_by,
      created_at
    )
    VALUES (
      extensions.gen_random_uuid(),
      (
        SELECT c_new.id
        FROM public.canvases c_new
        WHERE c_new.stream_id = v_new_stream
        LIMIT 1
      ),
      v_new_stream,
      cv.content_json,
      cv.raw_markdown,
      COALESCE(cv.content_format, 'markdown+blocknote-v1'),
      cv.name,
      cv.summary,
      cv.created_by,
      COALESCE(cv.created_at, now())
    );
  END LOOP;

  RETURN v_new_domain_id;
END;
$$;
