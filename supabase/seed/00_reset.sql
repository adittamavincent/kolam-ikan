-- Truncate all tables (respects foreign keys with CASCADE)
TRUNCATE TABLE 
  sections,
  entries,
  canvases,
  canvas_versions,
  streams,
  cabinets,
  domains,
  personas,
  audit_logs
CASCADE;

-- Delete test user from auth.users
DELETE FROM auth.users WHERE email = 'test@kolamikan.local';