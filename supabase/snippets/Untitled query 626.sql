-- Create test user
SELECT auth.uid(); -- Should return null (not authenticated)

-- Verify policies block unauthenticated access
SELECT * FROM domains; -- Should return empty (RLS blocking)
