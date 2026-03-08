ALTER TABLE "public"."streams"
  ADD COLUMN IF NOT EXISTS "stream_kind" text NOT NULL DEFAULT 'REGULAR';

ALTER TABLE "public"."streams"
  ADD COLUMN IF NOT EXISTS "is_system_global" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."streams"
  DROP CONSTRAINT IF EXISTS "streams_stream_kind_check";

ALTER TABLE "public"."streams"
  ADD CONSTRAINT "streams_stream_kind_check"
  CHECK ("stream_kind" IN ('GLOBAL', 'REGULAR'));

ALTER TABLE "public"."streams"
  DROP CONSTRAINT IF EXISTS "streams_global_stream_root_check";

ALTER TABLE "public"."streams"
  ADD CONSTRAINT "streams_global_stream_root_check"
  CHECK ("stream_kind" <> 'GLOBAL' OR "cabinet_id" IS NULL);

ALTER TABLE "public"."streams"
  DROP CONSTRAINT IF EXISTS "streams_system_global_kind_check";

ALTER TABLE "public"."streams"
  ADD CONSTRAINT "streams_system_global_kind_check"
  CHECK (NOT "is_system_global" OR "stream_kind" = 'GLOBAL');

CREATE INDEX IF NOT EXISTS "idx_streams_domain_kind"
  ON "public"."streams" USING "btree" ("domain_id", "stream_kind")
  WHERE ("deleted_at" IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_system_global_stream_per_domain"
  ON "public"."streams" USING "btree" ("domain_id")
  WHERE ("is_system_global" = true AND "deleted_at" IS NULL);

CREATE OR REPLACE FUNCTION "public"."create_global_stream_for_new_domain"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "public"."streams" (
    "domain_id",
    "cabinet_id",
    "name",
    "description",
    "sort_order",
    "stream_kind",
    "is_system_global"
  ) VALUES (
    NEW."id",
    NULL,
    'Global User Entry',
    'Core storyline and foundational user context for this domain.',
    -100,
    'GLOBAL',
    true
  )
  ON CONFLICT ("domain_id") WHERE ("is_system_global" = true AND "deleted_at" IS NULL)
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trigger_create_global_stream_for_domain" ON "public"."domains";

CREATE TRIGGER "trigger_create_global_stream_for_domain"
AFTER INSERT ON "public"."domains"
FOR EACH ROW
EXECUTE FUNCTION "public"."create_global_stream_for_new_domain"();

CREATE OR REPLACE FUNCTION "public"."enforce_system_global_stream_rules"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."is_system_global" = true THEN
    IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" THEN
      RAISE EXCEPTION 'System global stream cannot be deleted';
    END IF;

    IF NEW."cabinet_id" IS NOT NULL THEN
      RAISE EXCEPTION 'System global stream must stay at root';
    END IF;

    IF NEW."stream_kind" <> 'GLOBAL' THEN
      RAISE EXCEPTION 'System global stream kind cannot be changed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trigger_enforce_system_global_stream_rules" ON "public"."streams";

CREATE TRIGGER "trigger_enforce_system_global_stream_rules"
BEFORE UPDATE ON "public"."streams"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_system_global_stream_rules"();

INSERT INTO "public"."streams" (
  "domain_id",
  "cabinet_id",
  "name",
  "description",
  "sort_order",
  "stream_kind",
  "is_system_global"
)
SELECT
  d."id",
  NULL,
  'Global User Entry',
  'Core storyline and foundational user context for this domain.',
  -100,
  'GLOBAL',
  true
FROM "public"."domains" d
WHERE d."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."streams" s
    WHERE s."domain_id" = d."id"
      AND s."is_system_global" = true
      AND s."deleted_at" IS NULL
  );