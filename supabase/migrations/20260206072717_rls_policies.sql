-- Enable RLS on all tables
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;

-- Personas Policies
CREATE POLICY "Users can view their own personas and system AI personas"
  ON personas FOR SELECT
  USING (
    user_id = auth.uid() OR 
    (is_system = TRUE AND type = 'AI')
  );

CREATE POLICY "Users can insert their own personas"
  ON personas FOR INSERT
  WITH CHECK (user_id = auth.uid() AND type = 'HUMAN');

CREATE POLICY "Users can update their own personas"
  ON personas FOR UPDATE
  USING (user_id = auth.uid() AND type = 'HUMAN');

-- Prefer soft deletes. Disallow hard DELETEs on personas to avoid FK issues and preserve historical data.
CREATE POLICY "No hard deletes on personas"
  ON personas FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) their own personas"
  ON personas FOR UPDATE
  USING (user_id = auth.uid() AND type = 'HUMAN')
  WITH CHECK (user_id = auth.uid() AND type = 'HUMAN');

-- Domains Policies
CREATE POLICY "Users can view their own domains"
  ON domains FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own domains"
  ON domains FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own domains"
  ON domains FOR UPDATE
  USING (user_id = auth.uid());

-- Disallow hard deletes on Domains to preserve historical integrity. Use `deleted_at` to soft-delete instead.
CREATE POLICY "No hard deletes on domains"
  ON domains FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) their own domains"
  ON domains FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Cabinets Policies
CREATE POLICY "Users can view cabinets in their domains"
  ON cabinets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = cabinets.domain_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert cabinets in their domains"
  ON cabinets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = cabinets.domain_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update cabinets in their domains"
  ON cabinets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = cabinets.domain_id
      AND domains.user_id = auth.uid()
    )
  );

-- Disallow hard deletes on Cabinets; soft-delete via `deleted_at`.
CREATE POLICY "No hard deletes on cabinets"
  ON cabinets FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) cabinets in their domains"
  ON cabinets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = cabinets.domain_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM domains
      WHERE domains.id = cabinets.domain_id
      AND domains.user_id = auth.uid()
    )
  );

-- Streams Policies (transitive through cabinets -> domains)
CREATE POLICY "Users can view streams in their domains"
  ON streams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cabinets
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE cabinets.id = streams.cabinet_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert streams in their domains"
  ON streams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cabinets
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE cabinets.id = streams.cabinet_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update streams in their domains"
  ON streams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM cabinets
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE cabinets.id = streams.cabinet_id
      AND domains.user_id = auth.uid()
    )
  );

-- Disallow hard deletes on Streams; soft-delete via `deleted_at`.
CREATE POLICY "No hard deletes on streams"
  ON streams FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) streams in their domains"
  ON streams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM cabinets
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE cabinets.id = streams.cabinet_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cabinets
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE cabinets.id = streams.cabinet_id
      AND domains.user_id = auth.uid()
    )
  );

-- Entries, Sections, Canvases Policies (soft-delete-first pattern)
-- Disallow hard deletes; use `deleted_at` to soft-delete entries, sections, and canvases. Policies follow transitive ownership similar to Streams.

CREATE POLICY "No hard deletes on entries"
  ON entries FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) their own entries"
  ON entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "No hard deletes on sections"
  ON sections FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) their own sections"
  ON sections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "No hard deletes on canvases"
  ON canvases FOR DELETE
  USING (false);

CREATE POLICY "Users can soft-delete (update deleted_at) their own canvases"
  ON canvases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );