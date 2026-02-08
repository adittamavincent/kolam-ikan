-- Fix missing RLS policies for entries and sections (assuming 20260208120000_allow_root_streams has run)
-- And ensure canvases are created for streams

-- 1. Entries Policies (Missing SELECT and INSERT)
-- Drop to be safe (though they likely don't exist or are incorrect)
DROP POLICY IF EXISTS "Users can view their own entries" ON entries;
DROP POLICY IF EXISTS "Users can insert their own entries" ON entries;
DROP POLICY IF EXISTS "Users can update their own entries" ON entries; -- Update existing if needed

CREATE POLICY "Users can view their own entries"
  ON entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own entries"
  ON entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

-- Update existing UPDATE policy just in case (though 120000 might have handled soft-delete, regular UPDATE might be missing)
CREATE POLICY "Users can update their own entries"
  ON entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

-- 2. Sections Policies (Missing SELECT)
DROP POLICY IF EXISTS "Users can view sections in their entries" ON sections;

CREATE POLICY "Users can view sections in their entries"
  ON sections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN domains ON domains.id = streams.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

-- 3. Create Trigger to automatically create Canvas for new Streams
CREATE OR REPLACE FUNCTION create_canvas_for_new_stream()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO canvases (stream_id, content_json)
  VALUES (NEW.id, '[]')
  ON CONFLICT (stream_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_canvas_for_stream ON streams;

CREATE TRIGGER trigger_create_canvas_for_stream
  AFTER INSERT ON streams
  FOR EACH ROW
  EXECUTE FUNCTION create_canvas_for_new_stream();

-- 4. Backfill missing canvases for existing streams
INSERT INTO canvases (stream_id, content_json)
SELECT id, '[]'
FROM streams
WHERE id NOT IN (SELECT stream_id FROM canvases)
AND deleted_at IS NULL;
