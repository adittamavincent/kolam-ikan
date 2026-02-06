-- 07_entries.sql

-- Entries for 'Understanding Hooks'
INSERT INTO entries (id, stream_id, created_at) VALUES
('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '3 days'),
('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '1 day');

-- Entries for 'Editing Workflow'
INSERT INTO entries (id, stream_id, created_at) VALUES
('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', NOW() - INTERVAL '5 hours');