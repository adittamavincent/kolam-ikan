DO $$
BEGIN
    -- Drop the check constraint if it exists
    ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_section_type_check;

    -- Rename section_pdf_attachments to section_attachments if it exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'section_pdf_attachments') THEN
        ALTER TABLE section_pdf_attachments RENAME TO section_attachments;
    END IF;

    -- Rename pdf_display_mode to file_display_mode if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sections' AND column_name = 'pdf_display_mode') THEN
        ALTER TABLE sections RENAME COLUMN pdf_display_mode TO file_display_mode;
    END IF;

    -- Update section_type values
    UPDATE sections SET section_type = 'FILE_ATTACHMENT' WHERE section_type = 'PDF';

    -- Add back a widened check constraint
    IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'sections_section_type_check') THEN
        ALTER TABLE sections ADD CONSTRAINT sections_section_type_check 
          CHECK (section_type = ANY (ARRAY['PERSONA'::text, 'FILE_ATTACHMENT'::text]));
    END IF;
END $$;

-- Update shadow persona cleanup function to use new table name
create or replace function public.cleanup_unused_shadow_persona(p_persona_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_persona_id is null then
    return;
  end if;

  delete from public.personas p
  where p.id = p_persona_id
    and p.is_shadow = true
    and not exists (
      select 1
      from public.sections s
      where s.persona_id = p_persona_id
    )
    and not exists (
      select 1
      from public.section_attachments a
      where a.referenced_persona_id = p_persona_id
    );
end;
$$;

-- Update shadow persona attachment trigger function
create or replace function public.cleanup_shadow_persona_from_attachments()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.referenced_persona_id is distinct from old.referenced_persona_id then
      perform public.cleanup_unused_shadow_persona(old.referenced_persona_id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.cleanup_unused_shadow_persona(old.referenced_persona_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

-- Re-attach trigger to the new table name
DROP TRIGGER IF EXISTS trg_cleanup_shadow_persona_attachments ON public.section_attachments;
create trigger trg_cleanup_shadow_persona_attachments
after update of referenced_persona_id or delete on public.section_attachments
for each row execute function public.cleanup_shadow_persona_from_attachments();

-- Update the update_updated_at trigger for the new table
DROP TRIGGER IF EXISTS update_section_pdf_attachments_updated_at ON public.section_attachments;
CREATE TRIGGER update_section_attachments_updated_at
BEFORE UPDATE ON public.section_attachments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update duplicate_domain function
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
  s_att RECORD;
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

  -- Copy cabinets
  FOR cab IN SELECT id, parent_id, name, sort_order FROM cabinets WHERE domain_id = p_orig_domain_id AND deleted_at IS NULL LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO cabinets (id, domain_id, parent_id, name, sort_order, created_at, updated_at)
    VALUES (v_new_id, v_new_domain_id, NULL, cab.name, cab.sort_order, now(), now());
    INSERT INTO temp_cab_map VALUES (cab.id, v_new_id, cab.parent_id);
  END LOOP;

  -- Update parent references
  UPDATE cabinets cab_target
  SET parent_id = m_parent.new_id
  FROM temp_cab_map m_parent, temp_cab_map m
  WHERE cab_target.id = m.new_id
    AND m.old_parent IS NOT NULL
    AND m.old_parent = m_parent.old_id;

  SELECT id INTO v_target_global_stream FROM streams WHERE domain_id = v_new_domain_id AND is_system_global = true AND deleted_at IS NULL LIMIT 1;

  -- Copy streams
  FOR s IN SELECT id, cabinet_id, name, description, sort_order, stream_kind, is_system_global FROM streams WHERE domain_id = p_orig_domain_id AND deleted_at IS NULL LOOP
    IF s.is_system_global THEN
      UPDATE streams SET name = s.name, description = s.description, sort_order = s.sort_order, updated_at = now() WHERE id = v_target_global_stream;
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

  -- Copy sections
  FOR sec IN SELECT * FROM sections WHERE entry_id IN (SELECT old_id FROM temp_entry_map) LOOP
    v_new_id := extensions.gen_random_uuid();
    INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order, section_type, file_display_mode, created_at, updated_at)
    VALUES (
      v_new_id,
      (SELECT new_id FROM temp_entry_map WHERE old_id = sec.entry_id LIMIT 1),
      sec.persona_id,
      sec.persona_name_snapshot,
      sec.content_json,
      sec.sort_order,
      sec.section_type,
      sec.file_display_mode,
      now(),
      now()
    );
    INSERT INTO temp_section_map VALUES (sec.id, v_new_id);
  END LOOP;

  -- Copy section attachments
  FOR s_att IN SELECT * FROM section_attachments WHERE section_id IN (SELECT old_id FROM temp_section_map) LOOP
    INSERT INTO section_attachments (id, section_id, document_id, sort_order, title_snapshot, annotation_text, referenced_persona_id, referenced_page, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      (SELECT new_id FROM temp_section_map WHERE old_id = s_att.section_id LIMIT 1),
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

  -- Copy document entry links
  INSERT INTO document_entry_links (document_id, entry_id, relationship_type, created_at)
  SELECT del.document_id, m.new_id, del.relationship_type, now()
  FROM document_entry_links del
  JOIN temp_entry_map m ON del.entry_id = m.old_id;

  -- Copy canvases
  FOR canvas_row IN SELECT * FROM canvases WHERE stream_id IN (SELECT old_id FROM temp_stream_map) LOOP
    INSERT INTO canvases (id, stream_id, content_json, created_at, updated_at)
    VALUES (
      extensions.gen_random_uuid(),
      (SELECT new_id FROM temp_stream_map WHERE old_id = canvas_row.stream_id LIMIT 1),
      canvas_row.content_json,
      now(),
      now()
    )
    ON CONFLICT (stream_id) DO UPDATE SET
      content_json = EXCLUDED.content_json,
      updated_at = now();
  END LOOP;

  -- Copy canvas versions
  FOR cv IN SELECT stream_id, content_json, name, summary, created_by, created_at FROM canvas_versions WHERE stream_id IN (SELECT old_id FROM temp_stream_map) ORDER BY created_at ASC NULLS LAST LOOP
    INSERT INTO canvas_versions (id, canvas_id, stream_id, content_json, name, summary, created_by, created_at)
    VALUES (
      extensions.gen_random_uuid(),
      (SELECT c_new.id FROM canvases c_new WHERE c_new.stream_id = (SELECT new_id FROM temp_stream_map WHERE old_id = cv.stream_id LIMIT 1) LIMIT 1),
      (SELECT new_id FROM temp_stream_map WHERE old_id = cv.stream_id LIMIT 1),
      cv.content_json, cv.name, cv.summary, cv.created_by, COALESCE(cv.created_at, now())
    );
  END LOOP;

  RETURN v_new_domain_id;
END;
$$;
