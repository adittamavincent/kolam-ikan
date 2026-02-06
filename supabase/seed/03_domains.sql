-- 03_domains.sql
-- We assign specific IDs so we can reference them in cabinets

INSERT INTO domains (id, user_id, name, icon, description, sort_order) VALUES
('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Programming', 'terminal', 'Transition from Music to SE', 0),
('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Internship', 'briefcase', 'Media company work logs', 1),
('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Gym', 'dumbbell', 'Life expectancy improvement', 2),
('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Scholarship', 'graduation-cap', 'AI Engineering Bootcamp', 3),
('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'HIMA', 'users', 'Student Union politics', 4);