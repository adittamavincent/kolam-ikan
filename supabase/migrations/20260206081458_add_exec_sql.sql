-- Function to execute raw SQL via RPC (used by seed.ts)
-- Security Definer allows it to run with the privileges of the creator (usually postgres/admin)
-- This is necessary to insert into auth.users or truncate tables with FKs
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql;
END;
$$;