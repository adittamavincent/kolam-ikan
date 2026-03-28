ALTER TABLE public.streams
  ADD COLUMN IF NOT EXISTS description text;

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
    SELECT id, cabinet_id, name, description, sort_order, stream_kind
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
          description = s.description,
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
    INSERT INTO streams (id, cabinet_id, name, description, sort_order, created_at, updated_at, deleted_at, domain_id, stream_kind)
    VALUES (v_new_stream, v_new_cab, s.name, s.description, s.sort_order, now(), now(), NULL, v_new_domain_id, s.stream_kind);
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
    VALUES (v_new_entry, v_new_stream, now(), now(), NULL, COALESCE(e.is_draft, false));
    v_entry_map := v_entry_map || jsonb_build_object(e.id::text, v_new_entry::text);
  END LOOP;

  FOR sec IN
    SELECT id, entry_id, parent_section_id, section_type, content_json, persona_id, persona_name_snapshot, order_index, created_at, updated_at, file_display_mode, raw_markdown, content_format
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
      AND deleted_at IS NULL
  LOOP
    v_new_entry := (v_entry_map ->> sec.entry_id::text)::uuid;
    IF v_new_entry IS NULL THEN
      CONTINUE;
    END IF;

    v_new_section := extensions.gen_random_uuid();
    INSERT INTO sections (
      id, entry_id, parent_section_id, section_type, content_json, persona_id,
      persona_name_snapshot, order_index, created_at, updated_at, deleted_at,
      file_display_mode, raw_markdown, content_format
    )
    VALUES (
      v_new_section, v_new_entry, NULL, sec.section_type, sec.content_json, sec.persona_id,
      sec.persona_name_snapshot, sec.order_index, sec.created_at, sec.updated_at, NULL,
      sec.file_display_mode, COALESCE(sec.raw_markdown, ''), COALESCE(sec.content_format, 'markdown+blocknote-v1')
    );
    v_section_map := v_section_map || jsonb_build_object(sec.id::text, v_new_section::text);
  END LOOP;

  FOR sec IN
    SELECT id, parent_section_id
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
      AND deleted_at IS NULL
      AND parent_section_id IS NOT NULL
  LOOP
    UPDATE sections
    SET parent_section_id = (v_section_map ->> sec.parent_section_id::text)::uuid
    WHERE id = (v_section_map ->> sec.id::text)::uuid;
  END LOOP;

  FOR s_att IN
    SELECT section_id, document_id, sort_order, created_at
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
        AND deleted_at IS NULL
    )
  LOOP
    v_new_section := (v_section_map ->> s_att.section_id::text)::uuid;
    IF v_new_section IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO section_attachments (section_id, document_id, sort_order, created_at)
    VALUES (v_new_section, s_att.document_id, s_att.sort_order, s_att.created_at)
    ON CONFLICT (section_id, document_id) DO NOTHING;
  END LOOP;

  FOR del IN
    SELECT id, stream_id, title, status, created_at, updated_at, source_url, source_name, source_kind,
           storage_bucket, storage_path, mime_type, file_size, thumbnail_path, thumbnail_status,
           thumbnail_updated_at, thumbnail_error
    FROM documents
    WHERE stream_id IN (
      SELECT id
      FROM streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
      AND deleted_at IS NULL
  LOOP
    v_new_stream := (v_stream_map ->> del.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO documents (
      id, stream_id, title, status, created_at, updated_at, deleted_at,
      source_url, source_name, source_kind, storage_bucket, storage_path,
      mime_type, file_size, thumbnail_path, thumbnail_status,
      thumbnail_updated_at, thumbnail_error
    )
    VALUES (
      del.id, v_new_stream, del.title, del.status, del.created_at, del.updated_at, NULL,
      del.source_url, del.source_name, del.source_kind, del.storage_bucket, del.storage_path,
      del.mime_type, del.file_size, del.thumbnail_path, del.thumbnail_status,
      del.thumbnail_updated_at, del.thumbnail_error
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR canvas_row IN
    SELECT id, stream_id, title, content_json, raw_markdown, content_format, created_at, updated_at
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

    INSERT INTO canvases (id, stream_id, title, content_json, raw_markdown, content_format, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(), v_new_stream, canvas_row.title, canvas_row.content_json,
      COALESCE(canvas_row.raw_markdown, ''), COALESCE(canvas_row.content_format, 'markdown+blocknote-v1'),
      canvas_row.created_at, canvas_row.updated_at
    )
    ON CONFLICT (stream_id) DO UPDATE
      SET title = EXCLUDED.title,
          content_json = EXCLUDED.content_json,
          raw_markdown = EXCLUDED.raw_markdown,
          content_format = EXCLUDED.content_format,
          updated_at = EXCLUDED.updated_at;
  END LOOP;

  FOR cv IN
    SELECT cv.id, cv.canvas_id, cv.name, cv.content_json, cv.raw_markdown, cv.content_format, cv.created_at,
           c.stream_id
    FROM canvas_versions cv
    JOIN canvases c ON c.id = cv.canvas_id
    WHERE c.stream_id IN (
      SELECT id
      FROM streams
      WHERE domain_id = p_orig_domain_id
        AND deleted_at IS NULL
    )
  LOOP
    v_new_stream := (v_stream_map ->> cv.stream_id::text)::uuid;
    IF v_new_stream IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO canvas_versions (id, canvas_id, name, content_json, raw_markdown, content_format, created_at)
    SELECT extensions.gen_random_uuid(), c_new.id, cv.name, cv.content_json,
           COALESCE(cv.raw_markdown, ''), COALESCE(cv.content_format, 'markdown+blocknote-v1'), cv.created_at
    FROM canvases c_new
    WHERE c_new.stream_id = v_new_stream
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_new_domain_id;
END;
$$;
