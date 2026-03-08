-- Replace the blanket "No hard deletes" policy with one that allows
-- users to permanently delete their own non-system HUMAN personas.
DROP POLICY IF EXISTS "No hard deletes on personas" ON "public"."personas";

CREATE POLICY "Users can hard-delete their own personas"
  ON "public"."personas"
  FOR DELETE
  USING (
    "user_id" = "auth"."uid"()
    AND "is_system" = false
    AND "type" = 'HUMAN'::"text"
  );
