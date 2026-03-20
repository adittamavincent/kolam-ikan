SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

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
  cab RECORD;
  s RECORD;
  e RECORD;
  sec RECORD;
  s_pdf RECORD;
  canvas_row RECORD;
  cv RECORD;
  v_new_cab uuid;
  v_new_stream uuid;
  v_new_entry uuid;
  v_target_global_stream uuid;
BEGIN
  -- Create the domain row
  INSERT INTO domains (id, user_id, name, icon, description, sort_order, settings, created_at, updated_at)
  SELECT extensions.gen_random_uuid(), p_new_user_id, COALESCE(p_new_name, name || ' — copy'), icon, description, sort_order, settings, now(), now()
  FROM domains
  WHERE id = p_orig_domain_id
  RETURNING id INTO v_new_domain_id;

  IF v_new_domain_id IS NULL THEN
    RAISE EXCEPTION 'original domain not found: %', p_orig_domain_id;
  END IF;

  -- Temporary mapping tables
  CREATE TEMP TABLE temp_cab_map (old_id uuid, new_id uuid, old_parent uuid) ON COMMIT DROP;
  CREATE TEMP TABLE temp_stream_map (old_id uuid, new_id uuid, old_cabinet_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE temp_entry_map (old_id uuid, new_id uuid, old_stream_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE temp_section_map (old_id uuid, new_id uuid) ON COMMIT DROP;

  -- Copy cabinets (insert without parent refs first)
  FOR cab IN SELECT id, parent_id, name, sort_order FROM cabinets WHERE domain_id = p_orig_domain_id AND deleted_at IS NULL LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO cabinets (id, domain_id, parent_id, name, sort_order, created_at, updated_at)
    VALUES (v_new_id, v_new_domain_id, NULL, cab.name, cab.sort_order, now(), now());
    INSERT INTO temp_cab_map VALUES (cab.id, v_new_id, cab.parent_id);
  END LOOP;

  -- Update parent references on duplicated cabinets
  UPDATE cabinets cab_target
  SET parent_id = m_parent.new_id
  FROM temp_cab_map m_parent, temp_cab_map m
  WHERE cab_target.id = m.new_id
    AND m.old_parent IS NOT NULL
    AND m.old_parent = m_parent.old_id;

  SELECT id
  INTO v_target_global_stream
  FROM streams
  WHERE domain_id = v_new_domain_id
    AND is_system_global = true
    AND deleted_at IS NULL
  LIMIT 1;

  -- Copy streams, but reuse the auto-created target global stream
  FOR s IN
    SELECT id, cabinet_id, name, description, sort_order, stream_kind, is_system_global
    FROM streams
    WHERE domain_id = p_orig_domain_id
      AND deleted_at IS NULL
  LOOP
    IF s.is_system_global THEN
      IF v_target_global_stream IS NULL THEN
        RAISE EXCEPTION 'target global stream not found for duplicated domain: %', v_new_domain_id;
      END IF;

      UPDATE streams
      SET name = s.name,
          description = s.description,
          sort_order = s.sort_order,
          updated_at = now()
      WHERE id = v_target_global_stream;

      INSERT INTO temp_stream_map VALUES (s.id, v_target_global_stream, s.cabinet_id);
      CONTINUE;
    END IF;

    v_new_stream := extensions.gen_random_uuid();
    SELECT new_id INTO v_new_cab FROM temp_cab_map WHERE old_id = s.cabinet_id LIMIT 1;
    INSERT INTO streams (id, cabinet_id, name, description, sort_order, created_at, updated_at, deleted_at, domain_id, stream_kind, is_system_global)
    VALUES (v_new_stream, v_new_cab, s.name, s.description, s.sort_order, now(), now(), NULL, v_new_domain_id, s.stream_kind, false);
    INSERT INTO temp_stream_map VALUES (s.id, v_new_stream, s.cabinet_id);
  END LOOP;

  -- Copy entries
  FOR e IN SELECT id, stream_id, is_draft FROM entries WHERE stream_id IN (SELECT old_id FROM temp_stream_map) AND deleted_at IS NULL LOOP
    v_new_entry := extensions.gen_random_uuid();
    SELECT new_id INTO v_new_stream FROM temp_stream_map WHERE old_id = e.stream_id LIMIT 1;
    INSERT INTO entries (id, stream_id, created_at, updated_at, deleted_at, is_draft)
    VALUES (v_new_entry, v_new_stream, now(), now(), NULL, e.is_draft);
    INSERT INTO temp_entry_map VALUES (e.id, v_new_entry, e.stream_id);
  END LOOP;

  -- Copy sections (preserve persona_id, section_type, pdf_display_mode, etc.)
  FOR sec IN SELECT * FROM sections WHERE entry_id IN (SELECT old_id FROM temp_entry_map) LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order, section_type, pdf_display_mode, created_at, updated_at)
    VALUES (
      v_new_id,
      (SELECT new_id FROM temp_entry_map WHERE old_id = sec.entry_id LIMIT 1),
      sec.persona_id,
      sec.persona_name_snapshot,
      sec.content_json,
      sec.sort_order,
      sec.section_type,
      sec.pdf_display_mode,
      now(),
      now()
    );
    INSERT INTO temp_section_map VALUES (sec.id, v_new_id);
  END LOOP;

  -- Copy section PDF attachments
  FOR s_pdf IN SELECT * FROM section_pdf_attachments WHERE section_id IN (SELECT old_id FROM temp_section_map) LOOP
    INSERT INTO section_pdf_attachments (id, section_id, document_id, sort_order, title_snapshot, annotation_text, referenced_persona_id, referenced_page, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      (SELECT new_id FROM temp_section_map WHERE old_id = s_pdf.section_id LIMIT 1),
      s_pdf.document_id,
      s_pdf.sort_order,
      s_pdf.title_snapshot,
      s_pdf.annotation_text,
      s_pdf.referenced_persona_id,
      s_pdf.referenced_page,
      now(),
      now()
    );
  END LOOP;

  -- Copy document entry links
  INSERT INTO document_entry_links (document_id, entry_id, relationship_type, created_at)
  SELECT del.document_id, m.new_id, del.relationship_type, now()
  FROM document_entry_links del
  JOIN temp_entry_map m ON del.entry_id = m.old_id;

  -- Copy canvases (per-stream), updating the auto-created target canvas in place
  FOR canvas_row IN
    SELECT *
    FROM canvases
    WHERE stream_id IN (SELECT old_id FROM temp_stream_map)
  LOOP
    INSERT INTO canvases (id, stream_id, content_json, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      (SELECT new_id FROM temp_stream_map WHERE old_id = canvas_row.stream_id LIMIT 1),
      canvas_row.content_json,
      now(),
      now()
    )
    ON CONFLICT (stream_id)
    DO UPDATE SET
      content_json = EXCLUDED.content_json,
      updated_at = now();
  END LOOP;

  -- Copy canvas snapshots/timeline versions in chronological order
  FOR cv IN
    SELECT stream_id, content_json, name, summary, created_by, created_at
    FROM canvas_versions
    WHERE stream_id IN (SELECT old_id FROM temp_stream_map)
    ORDER BY created_at ASC NULLS LAST
  LOOP
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
        WHERE c_new.stream_id = (
          SELECT new_id
          FROM temp_stream_map
          WHERE old_id = cv.stream_id
          LIMIT 1
        )
        LIMIT 1
      ),
      (
        SELECT new_id
        FROM temp_stream_map
        WHERE old_id = cv.stream_id
        LIMIT 1
      ),
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

ALTER FUNCTION public.duplicate_domain(uuid, text, uuid) OWNER TO postgres;
