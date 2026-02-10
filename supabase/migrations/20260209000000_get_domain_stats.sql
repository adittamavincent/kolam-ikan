-- Function to get stats for all domains of a user in a single efficient query
-- Replaces N+1 API calls in the dashboard
CREATE OR REPLACE FUNCTION get_domain_stats(p_user_id UUID)
RETURNS TABLE (
  domain_id UUID,
  cabinet_count BIGINT,
  stream_count BIGINT,
  entry_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id as domain_id,
    -- Cabinet Count (active only)
    (
      SELECT COUNT(*)
      FROM cabinets c
      WHERE c.domain_id = d.id
        AND c.deleted_at IS NULL
    ) as cabinet_count,
    -- Stream Count (active streams in active cabinets)
    (
      SELECT COUNT(*)
      FROM streams s
      JOIN cabinets c ON s.cabinet_id = c.id
      WHERE c.domain_id = d.id
        AND c.deleted_at IS NULL
        AND s.deleted_at IS NULL
    ) as stream_count,
    -- Entry Count (active entries in active streams in active cabinets)
    -- Note: Counts drafts as well, matching previous dashboard logic
    (
      SELECT COUNT(*)
      FROM entries e
      JOIN streams s ON e.stream_id = s.id
      JOIN cabinets c ON s.cabinet_id = c.id
      WHERE c.domain_id = d.id
        AND c.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND e.deleted_at IS NULL
    ) as entry_count
  FROM domains d
  WHERE d.user_id = p_user_id
    AND d.deleted_at IS NULL
  ORDER BY d.sort_order ASC;
END;
$$ LANGUAGE plpgsql;
