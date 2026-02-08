-- Function to create entry and section in a single transaction
CREATE OR REPLACE FUNCTION create_entry_with_section(
  p_stream_id uuid,
  p_content_json jsonb,
  p_persona_id uuid DEFAULT NULL,
  p_persona_name_snapshot text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_section_id uuid;
  v_result jsonb;
BEGIN
  -- Insert Entry
  INSERT INTO entries (stream_id)
  VALUES (p_stream_id)
  RETURNING id INTO v_entry_id;

  -- Insert Section
  INSERT INTO sections (entry_id, content_json, persona_id, persona_name_snapshot, sort_order)
  VALUES (v_entry_id, p_content_json, p_persona_id, p_persona_name_snapshot, 0)
  RETURNING id INTO v_section_id;

  -- Return the full object structure expected by the frontend
  SELECT jsonb_build_object(
    'id', e.id,
    'stream_id', e.stream_id,
    'created_at', e.created_at,
    'updated_at', e.updated_at,
    'deleted_at', e.deleted_at,
    'sections', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'entry_id', s.entry_id,
          'content_json', s.content_json,
          'persona_id', s.persona_id,
          'persona_name_snapshot', s.persona_name_snapshot,
          'sort_order', s.sort_order,
          'created_at', s.created_at,
          'updated_at', s.updated_at,
          'search_text', s.search_text,
          'persona', p
        )
      )
      FROM sections s
      LEFT JOIN personas p ON s.persona_id = p.id
      WHERE s.entry_id = e.id
    )
  ) INTO v_result
  FROM entries e
  WHERE e.id = v_entry_id;

  RETURN v_result;
END;
$$;
