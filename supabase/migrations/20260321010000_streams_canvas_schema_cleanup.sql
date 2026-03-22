-- Collapse redundant stream metadata, remove unused stream descriptions,
-- and replace stored canvas search text with an indexed expression + RPC.

WITH ranked_globals AS (
  SELECT
    s.id,
    ROW_NUMBER() OVER (
      PARTITION BY s.domain_id
      ORDER BY
        CASE WHEN COALESCE(s.is_system_global, false) THEN 0 ELSE 1 END,
        s.sort_order ASC,
        s.created_at ASC NULLS LAST,
        s.id ASC
    ) AS global_rank
  FROM public.streams s
  WHERE s.deleted_at IS NULL
    AND (
      s.stream_kind = 'GLOBAL'
      OR COALESCE(s.is_system_global, false)
      OR (s.cabinet_id IS NULL AND s.sort_order = -100)
    )
)
UPDATE public.streams s
SET
  stream_kind = CASE WHEN rg.global_rank = 1 THEN 'GLOBAL' ELSE 'REGULAR' END,
  cabinet_id = CASE WHEN rg.global_rank = 1 THEN NULL ELSE s.cabinet_id END,
  updated_at = NOW()
FROM ranked_globals rg
WHERE s.id = rg.id;

INSERT INTO public.streams (
  domain_id,
  cabinet_id,
  name,
  sort_order,
  stream_kind
)
SELECT
  d.id,
  NULL,
  'Global User Entry',
  -100,
  'GLOBAL'
FROM public.domains d
WHERE d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.streams s
    WHERE s.domain_id = d.id
      AND s.deleted_at IS NULL
      AND s.stream_kind = 'GLOBAL'
  );

DROP TRIGGER IF EXISTS "trigger_enforce_system_global_stream_rules" ON public.streams;
DROP TRIGGER IF EXISTS "trigger_enforce_global_stream_rules" ON public.streams;

DROP FUNCTION IF EXISTS public.enforce_system_global_stream_rules();
DROP FUNCTION IF EXISTS public.enforce_global_stream_rules();

CREATE OR REPLACE FUNCTION public.enforce_global_stream_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stream_kind = 'GLOBAL' AND NEW.cabinet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Global stream must stay at root';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND OLD.stream_kind = 'GLOBAL' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      RAISE EXCEPTION 'Global stream cannot be deleted';
    END IF;

    IF NEW.stream_kind <> 'GLOBAL' THEN
      RAISE EXCEPTION 'Global stream kind cannot be changed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trigger_enforce_global_stream_rules"
BEFORE INSERT OR UPDATE ON public.streams
FOR EACH ROW
EXECUTE FUNCTION public.enforce_global_stream_rules();

DROP TRIGGER IF EXISTS "trigger_create_global_stream_for_domain" ON public.domains;

CREATE OR REPLACE FUNCTION public.create_global_stream_for_new_domain()
RETURNS trigger
LANGUAGE plpgsql
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
    'Global User Entry',
    -100,
    'GLOBAL'
  )
  ON CONFLICT (domain_id)
  WHERE (stream_kind = 'GLOBAL' AND deleted_at IS NULL)
  DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trigger_create_global_stream_for_domain"
AFTER INSERT ON public.domains
FOR EACH ROW
EXECUTE FUNCTION public.create_global_stream_for_new_domain();

DROP INDEX IF EXISTS public.idx_unique_system_global_stream_per_domain;
DROP INDEX IF EXISTS public.idx_unique_global_stream_per_domain;

ALTER TABLE public.streams
  DROP CONSTRAINT IF EXISTS streams_system_global_kind_check,
  DROP CONSTRAINT IF EXISTS streams_global_stream_root_check,
  DROP CONSTRAINT IF EXISTS streams_stream_kind_check;

ALTER TABLE public.streams
  ADD CONSTRAINT streams_stream_kind_check
    CHECK (stream_kind IN ('GLOBAL', 'REGULAR')),
  ADD CONSTRAINT streams_global_stream_root_check
    CHECK (stream_kind <> 'GLOBAL' OR cabinet_id IS NULL);

CREATE UNIQUE INDEX idx_unique_global_stream_per_domain
  ON public.streams USING btree (domain_id)
  WHERE (stream_kind = 'GLOBAL' AND deleted_at IS NULL);

DROP FUNCTION IF EXISTS public.duplicate_domain(uuid, text, uuid);

ALTER TABLE public.streams
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS is_system_global;

DROP INDEX IF EXISTS public.idx_canvases_search_text;
DROP INDEX IF EXISTS public.idx_canvases_search_text_trgm;
DROP INDEX IF EXISTS public.idx_canvases_content_text_trgm;

ALTER TABLE public.canvases
  DROP COLUMN IF EXISTS search_text;

CREATE INDEX idx_canvases_content_text_trgm
  ON public.canvases
  USING gin ((public.jsonb_to_text(content_json)) extensions.gin_trgm_ops);

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
    LEFT(public.jsonb_to_text(c.content_json), 140) AS content_preview
  FROM public.canvases c
  JOIN public.streams s
    ON s.id = c.stream_id
   AND s.deleted_at IS NULL
  JOIN public.domains d
    ON d.id = s.domain_id
   AND d.deleted_at IS NULL
  WHERE public.jsonb_to_text(c.content_json) ILIKE '%' || COALESCE(p_query, '') || '%'
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 15), 1);
$$;

GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO anon;
GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_canvases(text, integer) TO service_role;

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
  INSERT INTO domains (id, user_id, name, icon, description, sort_order, settings, created_at, updated_at)
  SELECT extensions.gen_random_uuid(), p_new_user_id, COALESCE(p_new_name, name || ' — copy'), icon, description, sort_order, settings, now(), now()
  FROM domains
  WHERE id = p_orig_domain_id
  RETURNING id INTO v_new_domain_id;

  IF v_new_domain_id IS NULL THEN
    RAISE EXCEPTION 'original domain not found: %', p_orig_domain_id;
  END IF;

  FOR cab IN
    SELECT id, parent_id, name, sort_order
    FROM cabinets
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
  LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO cabinets (id, domain_id, parent_id, name, sort_order, created_at, updated_at)
    VALUES (v_new_id, v_new_domain_id, NULL, cab.name, cab.sort_order, now(), now());
    v_cab_map := v_cab_map || jsonb_build_object(cab.id::text, v_new_id::text);
  END LOOP;

  FOR cab IN
    SELECT id, parent_id
    FROM cabinets
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
      AND parent_id IS NOT NULL
  LOOP
    UPDATE cabinets
    SET parent_id = (v_cab_map ->> cab.parent_id::text)::uuid
    WHERE id = (v_cab_map ->> cab.id::text)::uuid;
  END LOOP;

  SELECT id
  INTO v_target_global_stream
  FROM streams
  WHERE domain_id = v_new_domain_id
    AND stream_kind = 'GLOBAL'
    AND deleted_at IS NULL
  LIMIT 1;

  FOR s IN
    SELECT id, cabinet_id, name, sort_order, stream_kind
    FROM streams
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
  LOOP
    IF s.stream_kind = 'GLOBAL' THEN
      IF v_target_global_stream IS NULL THEN
        RAISE EXCEPTION 'target global stream not found for duplicated domain: %', v_new_domain_id;
      END IF;

      UPDATE streams
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
    INSERT INTO streams (id, cabinet_id, name, sort_order, created_at, updated_at, deleted_at, domain_id, stream_kind)
    VALUES (v_new_stream, v_new_cab, s.name, s.sort_order, now(), now(), NULL, v_new_domain_id, s.stream_kind);
    v_stream_map := v_stream_map || jsonb_build_object(s.id::text, v_new_stream::text);
  END LOOP;

  FOR e IN
    SELECT id, stream_id, is_draft
    FROM entries
    WHERE stream_id IN (
      SELECT id
      FROM streams
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
    INSERT INTO entries (id, stream_id, created_at, updated_at, deleted_at, is_draft)
    VALUES (v_new_entry, v_new_stream, now(), now(), NULL, e.is_draft);
    v_entry_map := v_entry_map || jsonb_build_object(e.id::text, v_new_entry::text);
  END LOOP;

  FOR sec IN
    SELECT *
    FROM sections
    WHERE entry_id IN (
      SELECT id
      FROM entries
      WHERE stream_id IN (
        SELECT id
        FROM streams
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
    INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order, section_type, file_display_mode, created_at, updated_at)
    VALUES (
      v_new_section,
      v_new_entry,
      sec.persona_id,
      sec.persona_name_snapshot,
      sec.content_json,
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
    FROM section_attachments
    WHERE section_id IN (
      SELECT id
      FROM sections
      WHERE entry_id IN (
        SELECT id
        FROM entries
        WHERE stream_id IN (
          SELECT id
          FROM streams
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

    INSERT INTO section_attachments (id, section_id, document_id, sort_order, title_snapshot, annotation_text, referenced_persona_id, referenced_page, created_at, updated_at)
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
    FROM document_entry_links
    WHERE entry_id IN (
      SELECT id
      FROM entries
      WHERE stream_id IN (
        SELECT id
        FROM streams
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

    INSERT INTO document_entry_links (document_id, entry_id, relationship_type, created_at)
    VALUES (del.document_id, v_new_entry, del.relationship_type, now());
  END LOOP;

  FOR canvas_row IN
    SELECT *
    FROM canvases
    WHERE stream_id IN (
      SELECT id
      FROM streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
  LOOP
    v_new_stream := (v_stream_map ->> canvas_row.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO canvases (id, stream_id, content_json, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      v_new_stream,
      canvas_row.content_json,
      now(),
      now()
    )
    ON CONFLICT (stream_id)
    DO UPDATE SET
      content_json = EXCLUDED.content_json,
      updated_at = now();
  END LOOP;

  FOR cv IN
    SELECT stream_id, content_json, name, summary, created_by, created_at
    FROM canvas_versions
    WHERE stream_id IN (
      SELECT id
      FROM streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
    ORDER BY created_at ASC NULLS LAST
  LOOP
    v_new_stream := (v_stream_map ->> cv.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO canvas_versions (
      id,
      canvas_id,
      stream_id,
      content_json,
      name,
      summary,
      created_by,
      created_at
    )
    VALUES (
      extensions.gen_random_uuid(),
      (
        SELECT c_new.id
        FROM canvases c_new
        WHERE c_new.stream_id = v_new_stream
        LIMIT 1
      ),
      v_new_stream,
      cv.content_json,
      cv.name,
      cv.summary,
      cv.created_by,
      COALESCE(cv.created_at, now())
    );
  END LOOP;

  RETURN v_new_domain_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_bridge_action(audit_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  record_payload jsonb;
  audit_target_table text;
  audit_target_id uuid;
BEGIN
  SELECT al.payload, al.target_table, al.target_id
    INTO record_payload, audit_target_table, audit_target_id
  FROM public.audit_logs al
  WHERE al.id = audit_id
    AND al.expires_at > NOW();

  IF record_payload IS NULL THEN
    RAISE EXCEPTION 'Audit record not found or expired';
  END IF;

  PERFORM public.apply_audit_inverse(
    audit_target_table,
    audit_target_id,
    record_payload
  );
END;
$$;
