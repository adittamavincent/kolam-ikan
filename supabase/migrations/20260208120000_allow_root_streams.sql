-- Migration: Allow root-level streams by making cabinet_id nullable and adding domain_id

-- 1. Add domain_id to streams
ALTER TABLE streams ADD COLUMN domain_id UUID REFERENCES domains(id) ON DELETE RESTRICT;

-- 2. Backfill domain_id for existing streams
UPDATE streams
SET domain_id = cabinets.domain_id
FROM cabinets
WHERE streams.cabinet_id = cabinets.id;

-- 3. Enforce domain_id is NOT NULL
ALTER TABLE streams ALTER COLUMN domain_id SET NOT NULL;

-- 4. Make cabinet_id nullable
ALTER TABLE streams ALTER COLUMN cabinet_id DROP NOT NULL;

-- 5. Add settings column to domains for configuration (e.g. root restriction)
ALTER TABLE domains ADD COLUMN settings JSONB DEFAULT '{}'::jsonb;

-- 6. Update RLS policies

-- STREAMS
DROP POLICY IF EXISTS "Users can view streams in their domains" ON streams;
CREATE POLICY "Users can view streams in their domains"
  ON streams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = streams.domain_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert streams in their domains" ON streams;
CREATE POLICY "Users can insert streams in their domains"
  ON streams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = streams.domain_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update streams in their domains" ON streams;
CREATE POLICY "Users can update streams in their domains"
  ON streams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = streams.domain_id
      AND domains.user_id = auth.uid()
    )
  );

-- No hard deletes on streams (already exists, but good to ensure)
-- CREATE POLICY "No hard deletes on streams" ... (skipping as it likely doesn't need change if it was just returning false)
-- Wait, the soft-delete policy might need update if it relied on cabinet_id
-- Previous:
-- CREATE POLICY "Users can soft-delete (update deleted_at) streams in their domains"
--   ON streams FOR UPDATE
--   USING (
--     EXISTS (
--       SELECT 1 FROM cabinets
--       JOIN domains ON domains.id = cabinets.domain_id
--       WHERE cabinets.id = streams.cabinet_id
--       AND domains.user_id = auth.uid()
--     )
--   ) ...

DROP POLICY IF EXISTS "Users can soft-delete (update deleted_at) streams in their domains" ON streams;
CREATE POLICY "Users can soft-delete (update deleted_at) streams in their domains"
  ON streams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = streams.domain_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = streams.domain_id
      AND domains.user_id = auth.uid()
    )
  );

-- ENTRIES, SECTIONS, CANVASES
-- These relied on transitive relation: entries -> streams -> cabinets -> domains
-- Now: entries -> streams -> domains
-- So we should update them to be simpler and more robust (independent of cabinets)

-- ENTRIES
DROP POLICY IF EXISTS "Users can soft-delete (update deleted_at) their own entries" ON entries;
CREATE POLICY "Users can soft-delete (update deleted_at) their own entries"
  ON entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

-- SECTIONS
DROP POLICY IF EXISTS "Users can insert sections in their entries" ON sections;
CREATE POLICY "Users can insert sections in their entries"
  ON sections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN domains ON domains.id = streams.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update sections in their entries" ON sections;
CREATE POLICY "Users can update sections in their entries"
  ON sections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN domains ON domains.id = streams.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can soft-delete (update deleted_at) their own sections" ON sections;
CREATE POLICY "Users can soft-delete (update deleted_at) their own sections"
  ON sections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN domains ON domains.id = streams.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN domains ON domains.id = streams.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

-- CANVASES
DROP POLICY IF EXISTS "Users can view canvases in their streams" ON canvases;
CREATE POLICY "Users can view canvases in their streams"
  ON canvases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert canvases in their streams" ON canvases;
CREATE POLICY "Users can insert canvases in their streams"
  ON canvases FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update canvases in their streams" ON canvases;
CREATE POLICY "Users can update canvases in their streams"
  ON canvases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can soft-delete (update deleted_at) their own canvases" ON canvases;
CREATE POLICY "Users can soft-delete (update deleted_at) their own canvases"
  ON canvases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN domains ON domains.id = streams.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );
