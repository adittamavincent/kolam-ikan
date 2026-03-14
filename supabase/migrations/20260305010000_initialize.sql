


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


CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."apply_audit_inverse"("target_table" "text", "target_id" "uuid", "payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $_$
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
$_$;


ALTER FUNCTION "public"."apply_audit_inverse"("target_table" "text", "target_id" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_canvas_for_new_stream"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO canvases (stream_id, content_json)
  VALUES (NEW.id, '[]')
  ON CONFLICT (stream_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_canvas_for_new_stream"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid" DEFAULT NULL::"uuid", "p_persona_name_snapshot" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid" DEFAULT NULL::"uuid", "p_persona_name_snapshot" "text" DEFAULT NULL::"text", "p_is_draft" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_entry_id uuid;
  v_section_id uuid;
  v_result jsonb;
BEGIN
  -- Insert Entry
  INSERT INTO entries (stream_id, is_draft)
  VALUES (p_stream_id, p_is_draft)
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
    'is_draft', e.is_draft,
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


ALTER FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text", "p_is_draft" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."exec_sql"("sql" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    execute sql;
end;
$$;


ALTER FUNCTION "public"."exec_sql"("sql" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_domain_stats"("p_user_id" "uuid") RETURNS TABLE("domain_id" "uuid", "cabinet_count" bigint, "stream_count" bigint, "entry_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_domain_stats"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jsonb_to_text"("jsonb_data" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
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
$$;


ALTER FUNCTION "public"."jsonb_to_text"("jsonb_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_bridge_action"("audit_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."revert_bridge_action"("audit_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "target_table" "text",
    "target_id" "uuid",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cabinets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."cabinets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canvas_versions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "canvas_id" "uuid" NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "name" "text",
    "summary" "text",
    "content_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."canvas_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canvases" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "content_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "search_text" "text" GENERATED ALWAYS AS ("public"."jsonb_to_text"("content_json")) STORED,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."canvases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domains" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "settings" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entries" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "is_draft" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."personas" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "color" "text" NOT NULL,
    "is_system" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "personas_type_check" CHECK (("type" = ANY (ARRAY['HUMAN'::"text", 'AI'::"text"])))
);


ALTER TABLE "public"."personas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sections" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "entry_id" "uuid" NOT NULL,
    "persona_id" "uuid",
    "persona_name_snapshot" "text",
    "content_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "search_text" "text" GENERATED ALWAYS AS ("public"."jsonb_to_text"("content_json")) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."streams" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "cabinet_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "domain_id" "uuid" NOT NULL
);


ALTER TABLE "public"."streams" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cabinets"
    ADD CONSTRAINT "cabinets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."canvas_versions"
    ADD CONSTRAINT "canvas_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."canvases"
    ADD CONSTRAINT "canvases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."personas"
    ADD CONSTRAINT "personas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sections"
    ADD CONSTRAINT "sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streams"
    ADD CONSTRAINT "streams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."canvases"
    ADD CONSTRAINT "unique_canvas_per_stream" UNIQUE ("stream_id");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_cabinets_domain_id" ON "public"."cabinets" USING "btree" ("domain_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_canvas_versions_canvas_id" ON "public"."canvas_versions" USING "btree" ("canvas_id");



CREATE INDEX "idx_canvas_versions_stream_id" ON "public"."canvas_versions" USING "btree" ("stream_id");



CREATE INDEX "idx_canvases_search_text" ON "public"."canvases" USING "gin" ("to_tsvector"('"english"'::"regconfig", "search_text"));



CREATE INDEX "idx_canvases_search_text_trgm" ON "public"."canvases" USING "gin" ("search_text" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_canvases_stream_id" ON "public"."canvases" USING "btree" ("stream_id");



CREATE INDEX "idx_domains_user_id" ON "public"."domains" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_entries_created_at" ON "public"."entries" USING "btree" ("created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_entries_stream_id" ON "public"."entries" USING "btree" ("stream_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_sections_entry_id" ON "public"."sections" USING "btree" ("entry_id");



CREATE INDEX "idx_sections_search_text" ON "public"."sections" USING "gin" ("to_tsvector"('"english"'::"regconfig", "search_text"));



CREATE INDEX "idx_sections_search_text_trgm" ON "public"."sections" USING "gin" ("search_text" "extensions"."gin_trgm_ops");



CREATE INDEX "idx_streams_cabinet_id" ON "public"."streams" USING "btree" ("cabinet_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_unique_active_domain_name" ON "public"."domains" USING "btree" ("user_id", "name") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_unique_active_persona_name" ON "public"."personas" USING "btree" ("user_id", "name") WHERE ("deleted_at" IS NULL);



CREATE OR REPLACE TRIGGER "trigger_create_canvas_for_stream" AFTER INSERT ON "public"."streams" FOR EACH ROW EXECUTE FUNCTION "public"."create_canvas_for_new_stream"();



CREATE OR REPLACE TRIGGER "update_cabinets_updated_at" BEFORE UPDATE ON "public"."cabinets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_canvases_updated_at" BEFORE UPDATE ON "public"."canvases" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_domains_updated_at" BEFORE UPDATE ON "public"."domains" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_entries_updated_at" BEFORE UPDATE ON "public"."entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_personas_updated_at" BEFORE UPDATE ON "public"."personas" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sections_updated_at" BEFORE UPDATE ON "public"."sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_streams_updated_at" BEFORE UPDATE ON "public"."streams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cabinets"
    ADD CONSTRAINT "cabinets_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cabinets"
    ADD CONSTRAINT "cabinets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."cabinets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."canvas_versions"
    ADD CONSTRAINT "canvas_versions_canvas_id_fkey" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."canvas_versions"
    ADD CONSTRAINT "canvas_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."canvas_versions"
    ADD CONSTRAINT "canvas_versions_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."canvases"
    ADD CONSTRAINT "canvases_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."personas"
    ADD CONSTRAINT "personas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sections"
    ADD CONSTRAINT "sections_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sections"
    ADD CONSTRAINT "sections_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."streams"
    ADD CONSTRAINT "streams_cabinet_id_fkey" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."streams"
    ADD CONSTRAINT "streams_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE RESTRICT;



CREATE POLICY "No hard deletes on cabinets" ON "public"."cabinets" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on canvases" ON "public"."canvases" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on domains" ON "public"."domains" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on entries" ON "public"."entries" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on personas" ON "public"."personas" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on sections" ON "public"."sections" FOR DELETE USING (false);



CREATE POLICY "No hard deletes on streams" ON "public"."streams" FOR DELETE USING (false);



CREATE POLICY "Users can insert cabinets in their domains" ON "public"."cabinets" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "cabinets"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert canvases in their streams" ON "public"."canvases" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "canvases"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert sections in their entries" ON "public"."sections" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."entries"
     JOIN "public"."streams" ON (("streams"."id" = "entries"."stream_id")))
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("entries"."id" = "sections"."entry_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert streams in their domains" ON "public"."streams" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "streams"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own domains" ON "public"."domains" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own entries" ON "public"."entries" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "entries"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own personas" ON "public"."personas" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("type" = 'HUMAN'::"text")));



CREATE POLICY "Users can soft-delete (update deleted_at) cabinets in their dom" ON "public"."cabinets" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "cabinets"."domain_id") AND ("domains"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "cabinets"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can soft-delete (update deleted_at) streams in their doma" ON "public"."streams" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "streams"."domain_id") AND ("domains"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "streams"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can soft-delete (update deleted_at) their own canvases" ON "public"."canvases" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "canvases"."stream_id") AND ("domains"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "canvases"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can soft-delete (update deleted_at) their own domains" ON "public"."domains" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can soft-delete (update deleted_at) their own entries" ON "public"."entries" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "entries"."stream_id") AND ("domains"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "entries"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can soft-delete (update deleted_at) their own personas" ON "public"."personas" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND ("type" = 'HUMAN'::"text"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("type" = 'HUMAN'::"text")));



CREATE POLICY "Users can soft-delete (update deleted_at) their own sections" ON "public"."sections" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."entries"
     JOIN "public"."streams" ON (("streams"."id" = "entries"."stream_id")))
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("entries"."id" = "sections"."entry_id") AND ("domains"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."entries"
     JOIN "public"."streams" ON (("streams"."id" = "entries"."stream_id")))
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("entries"."id" = "sections"."entry_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update cabinets in their domains" ON "public"."cabinets" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "cabinets"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update canvases in their streams" ON "public"."canvases" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "canvases"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update sections in their entries" ON "public"."sections" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."entries"
     JOIN "public"."streams" ON (("streams"."id" = "entries"."stream_id")))
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("entries"."id" = "sections"."entry_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update streams in their domains" ON "public"."streams" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "streams"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own domains" ON "public"."domains" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own entries" ON "public"."entries" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "entries"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own personas" ON "public"."personas" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND ("type" = 'HUMAN'::"text")));



CREATE POLICY "Users can view cabinets in their domains" ON "public"."cabinets" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "cabinets"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view canvases in their streams" ON "public"."canvases" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "canvases"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view sections in their entries" ON "public"."sections" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."entries"
     JOIN "public"."streams" ON (("streams"."id" = "entries"."stream_id")))
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("entries"."id" = "sections"."entry_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view streams in their domains" ON "public"."streams" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."domains"
  WHERE (("domains"."id" = "streams"."domain_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own domains" ON "public"."domains" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own entries" ON "public"."entries" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."streams"
     JOIN "public"."domains" ON (("domains"."id" = "streams"."domain_id")))
  WHERE (("streams"."id" = "entries"."stream_id") AND ("domains"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own personas and system AI personas" ON "public"."personas" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (("is_system" = true) AND ("type" = 'AI'::"text"))));



ALTER TABLE "public"."cabinets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canvases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."personas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."streams" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_audit_inverse"("target_table" "text", "target_id" "uuid", "payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_audit_inverse"("target_table" "text", "target_id" "uuid", "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_audit_inverse"("target_table" "text", "target_id" "uuid", "payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_canvas_for_new_stream"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_canvas_for_new_stream"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_canvas_for_new_stream"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text", "p_is_draft" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text", "p_is_draft" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_entry_with_section"("p_stream_id" "uuid", "p_content_json" "jsonb", "p_persona_id" "uuid", "p_persona_name_snapshot" "text", "p_is_draft" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."exec_sql"("sql" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."exec_sql"("sql" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."exec_sql"("sql" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_domain_stats"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_domain_stats"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_domain_stats"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."jsonb_to_text"("jsonb_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."jsonb_to_text"("jsonb_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jsonb_to_text"("jsonb_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_bridge_action"("audit_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."revert_bridge_action"("audit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_bridge_action"("audit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."cabinets" TO "anon";
GRANT ALL ON TABLE "public"."cabinets" TO "authenticated";
GRANT ALL ON TABLE "public"."cabinets" TO "service_role";



GRANT ALL ON TABLE "public"."canvas_versions" TO "anon";
GRANT ALL ON TABLE "public"."canvas_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."canvas_versions" TO "service_role";



GRANT ALL ON TABLE "public"."canvases" TO "anon";
GRANT ALL ON TABLE "public"."canvases" TO "authenticated";
GRANT ALL ON TABLE "public"."canvases" TO "service_role";



GRANT ALL ON TABLE "public"."domains" TO "anon";
GRANT ALL ON TABLE "public"."domains" TO "authenticated";
GRANT ALL ON TABLE "public"."domains" TO "service_role";



GRANT ALL ON TABLE "public"."entries" TO "anon";
GRANT ALL ON TABLE "public"."entries" TO "authenticated";
GRANT ALL ON TABLE "public"."entries" TO "service_role";



GRANT ALL ON TABLE "public"."personas" TO "anon";
GRANT ALL ON TABLE "public"."personas" TO "authenticated";
GRANT ALL ON TABLE "public"."personas" TO "service_role";



GRANT ALL ON TABLE "public"."sections" TO "anon";
GRANT ALL ON TABLE "public"."sections" TO "authenticated";
GRANT ALL ON TABLE "public"."sections" TO "service_role";



GRANT ALL ON TABLE "public"."streams" TO "anon";
GRANT ALL ON TABLE "public"."streams" TO "authenticated";
GRANT ALL ON TABLE "public"."streams" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







