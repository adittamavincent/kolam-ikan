-- Add missing CRUD policies for Entries
CREATE POLICY "Users can view their own entries"
  ON entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own entries"
  ON entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own entries"
  ON entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = entries.stream_id
      AND domains.user_id = auth.uid()
    )
  );

-- Add missing CRUD policies for Sections
CREATE POLICY "Users can view sections in their entries"
  ON sections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM entries
      JOIN streams ON streams.id = entries.stream_id
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE entries.id = sections.entry_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert sections in their entries"
  ON sections FOR INSERT
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

CREATE POLICY "Users can update sections in their entries"
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
  );

-- Add missing CRUD policies for Canvases
CREATE POLICY "Users can view canvases in their streams"
  ON canvases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert canvases in their streams"
  ON canvases FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update canvases in their streams"
  ON canvases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM streams
      JOIN cabinets ON cabinets.id = streams.cabinet_id
      JOIN domains ON domains.id = cabinets.domain_id
      WHERE streams.id = canvases.stream_id
      AND domains.user_id = auth.uid()
    )
  );