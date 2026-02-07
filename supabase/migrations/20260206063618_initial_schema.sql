-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable PGCrypto for auth hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable Full Text Search extension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Robust function to convert BlockNote-like JSONB to plain text (extracts all "text" fields recursively)
-- MOVED UP: Must be defined before tables that use it in GENERATED columns
CREATE OR REPLACE FUNCTION jsonb_to_text(jsonb_data JSONB)
RETURNS TEXT AS $$
DECLARE
  result TEXT := '';
BEGIN
  WITH RECURSIVE nodes(node) AS (
    SELECT jsonb_data
    UNION ALL
    SELECT
        child
    FROM nodes,
    LATERAL (
        SELECT value AS child FROM jsonb_each(node) WHERE jsonb_typeof(node) = 'object'
        UNION ALL
        SELECT value AS child FROM jsonb_array_elements(node) WHERE jsonb_typeof(node) = 'array'
    ) AS children
  ),
  texts AS (
    SELECT (node->>'text') AS txt FROM nodes WHERE node ? 'text' AND (node->>'text') IS NOT NULL
  )
  SELECT string_agg(txt, ' ') INTO result FROM texts WHERE txt IS NOT NULL;

  RETURN TRIM(COALESCE(result, ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Personas Table
-- NOTE: The system adopts a *soft-delete-first* policy. Direct hard deletes are disallowed by policy; use `deleted_at` to soft-delete. Foreign keys to `auth.users` use `ON DELETE RESTRICT` to prevent accidental cascading hard deletes.
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('HUMAN', 'AI')),
  name TEXT NOT NULL,
  icon TEXT NOT NULL, -- Lucide icon identifier
  color TEXT NOT NULL, -- Hex color code
  is_system BOOLEAN DEFAULT FALSE, -- True for AI personas
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ

  -- NOTE: Do not use a UNIQUE constraint with nullable deleted_at; see partial index below.
);

-- Domains Table
-- NOTE: Domains are primary containers and follow the global soft-delete policy: use `deleted_at` to mark deletion. Foreign keys throughout the schema should avoid cascading hard deletes. A background Garbage Collection (GC) service will perform irreversible deletion on a configurable schedule (e.g., soft-deleted > 30 days) and must be an explicit admin operation.
CREATE TABLE domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Cabinets Table (Hierarchical)
CREATE TABLE cabinets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  parent_id UUID REFERENCES cabinets(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Streams Table
CREATE TABLE streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Entries Table (The Log)
CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Sections Table (Entry sub-units with authorship)
CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
  -- Allow persona to become NULL when persona is deleted; preserve a snapshot of the display name
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  persona_name_snapshot TEXT, -- store persona display name at time of creation for historical views
  content_json JSONB NOT NULL DEFAULT '[]',
  search_text TEXT GENERATED ALWAYS AS (
    jsonb_to_text(content_json)
  ) STORED,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Canvases Table (The Artifact)
CREATE TABLE canvases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE RESTRICT,
  content_json JSONB NOT NULL DEFAULT '[]',
  search_text TEXT GENERATED ALWAYS AS (
    jsonb_to_text(content_json)
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_canvas_per_stream UNIQUE (stream_id)
);

-- Canvas Versions (User-created milestones / snapshots)
CREATE TABLE canvas_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NULL, -- optional milestone name ("Draft v1", "Proposal" etc.)
  summary TEXT NULL, -- optional short description provided by user
  content_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX idx_domains_user_id ON domains(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cabinets_domain_id ON cabinets(domain_id) WHERE deleted_at IS NULL;

-- Partial Unique Indexes (Active Records Only)
CREATE UNIQUE INDEX idx_unique_active_persona_name
  ON personas (user_id, name)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_unique_active_domain_name
  ON domains (user_id, name)
  WHERE deleted_at IS NULL;

-- Audit Logs (for undo/history; entries may be retained for 24 hours to support Bridge undo)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- schedule a cleanup job to remove expired entries (e.g., created_at + interval '24 hours')
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_streams_cabinet_id ON streams(cabinet_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_stream_id ON entries(stream_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_created_at ON entries(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sections_entry_id ON sections(entry_id);
CREATE INDEX idx_canvases_stream_id ON canvases(stream_id);

-- Full Text Search Indexes
CREATE INDEX idx_sections_search_text ON sections USING GIN(to_tsvector('english', search_text));
CREATE INDEX idx_canvases_search_text ON canvases USING GIN(to_tsvector('english', search_text));

-- Trigram Indexes for Fuzzy Search
CREATE INDEX idx_sections_search_text_trgm ON sections USING GIN(search_text gin_trgm_ops);
CREATE INDEX idx_canvases_search_text_trgm ON canvases USING GIN(search_text gin_trgm_ops);

-- Indexes for Canvas Versions
CREATE INDEX idx_canvas_versions_canvas_id ON canvas_versions(canvas_id);
CREATE INDEX idx_canvas_versions_stream_id ON canvas_versions(stream_id);

-- Undo Function (Bridge Operations)
-- Stores inverse operations in audit_logs.payload and applies them when invoked.
CREATE OR REPLACE FUNCTION revert_bridge_action(audit_id UUID)
RETURNS VOID AS $$
DECLARE
  record_payload JSONB;
  target_table TEXT;
  target_id UUID;
BEGIN
  SELECT payload, target_table, target_id
    INTO record_payload, target_table, target_id
  FROM audit_logs
  WHERE id = audit_id
    AND expires_at > NOW();

  IF record_payload IS NULL THEN
    RAISE EXCEPTION 'Audit record not found or expired';
  END IF;

  -- The payload must store the inverse operation for the target_table.
  -- Required payload schema:
  -- {
  --   "op": "update" | "insert" | "delete",
  --   "before": { ...row },
  --   "after": { ...row },
  --   "table": "canvases" | "sections" | "entries" | "streams" | "cabinets" | "domains",
  --   "id": "<uuid>"
  -- }
  PERFORM apply_audit_inverse(target_table, target_id, record_payload);
END;
$$ LANGUAGE plpgsql;

-- Inverse Operation Helper
CREATE OR REPLACE FUNCTION apply_audit_inverse(
  target_table TEXT,
  target_id UUID,
  payload JSONB
)
RETURNS VOID AS $$
DECLARE
  op TEXT := payload->>'op';
  before_row JSONB := payload->'before';
  after_row JSONB := payload->'after';
  sql TEXT;
BEGIN
  IF op = 'update' THEN
    -- Revert to "before" state (explicit per-table mapping for Bridge targets)
    IF target_table = 'canvases' THEN
      UPDATE canvases
      SET content_json = before_row->'content_json',
          updated_at = NOW()
      WHERE id = target_id;
    ELSIF target_table = 'sections' THEN
      UPDATE sections
      SET content_json = before_row->'content_json',
          persona_id = (before_row->>'persona_id')::UUID,
          persona_name_snapshot = before_row->>'persona_name_snapshot',
          sort_order = COALESCE((before_row->>'sort_order')::INT, sort_order),
          updated_at = NOW()
      WHERE id = target_id;
    ELSE
      RAISE EXCEPTION 'apply_audit_inverse update not implemented for table %', target_table;
    END IF;
  ELSIF op = 'insert' THEN
    -- Undo insert by deleting the inserted row
    sql := format('DELETE FROM %I WHERE id = $1', target_table);
    EXECUTE sql USING target_id;
  ELSIF op = 'delete' THEN
    -- Undo delete by re-inserting the "before" row (must include all required columns)
    IF target_table = 'canvases' THEN
      INSERT INTO canvases (id, stream_id, content_json, created_at, updated_at)
      VALUES (
        (before_row->>'id')::UUID,
        (before_row->>'stream_id')::UUID,
        before_row->'content_json',
        (before_row->>'created_at')::TIMESTAMPTZ,
        NOW()
      );
    ELSIF target_table = 'sections' THEN
      INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order, created_at, updated_at)
      VALUES (
        (before_row->>'id')::UUID,
        (before_row->>'entry_id')::UUID,
        (before_row->>'persona_id')::UUID,
        before_row->>'persona_name_snapshot',
        before_row->'content_json',
        COALESCE((before_row->>'sort_order')::INT, 0),
        (before_row->>'created_at')::TIMESTAMPTZ,
        NOW()
      );
    ELSIF target_table = 'entries' THEN
      INSERT INTO entries (id, stream_id, created_at, updated_at, deleted_at)
      VALUES (
        (before_row->>'id')::UUID,
        (before_row->>'stream_id')::UUID,
        (before_row->>'created_at')::TIMESTAMPTZ,
        NOW(),
        NULL
      );
    ELSE
      RAISE EXCEPTION 'apply_audit_inverse delete restore not implemented for table %', target_table;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown audit op: %', op;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Updated At Trigger Function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply Updated At Triggers
CREATE TRIGGER update_personas_updated_at BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_domains_updated_at BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_cabinets_updated_at BEFORE UPDATE ON cabinets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON streams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_entries_updated_at BEFORE UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_sections_updated_at BEFORE UPDATE ON sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  
CREATE TRIGGER update_canvases_updated_at BEFORE UPDATE ON canvases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();