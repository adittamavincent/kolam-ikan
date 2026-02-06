-- 02_personas.sql

-- 1. Insert System AI Personas (No user_id, is_system = true)
INSERT INTO personas (id, type, name, icon, color, is_system) VALUES
('d0000000-0000-0000-0000-000000000001', 'AI', 'The Architect', 'dices', '#3B82F6', true),
('d0000000-0000-0000-0000-000000000002', 'AI', 'The Debugger', 'bug', '#EF4444', true),
('d0000000-0000-0000-0000-000000000003', 'AI', 'The Analyst', 'bar-chart', '#10B981', true),
('d0000000-0000-0000-0000-000000000004', 'AI', 'The Writer', 'feather', '#8B5CF6', true),
('d0000000-0000-0000-0000-000000000005', 'AI', 'The Critic', 'target', '#F59E0B', true);

-- 2. Insert User Human Personas (Linked to Test User)
INSERT INTO personas (id, user_id, type, name, icon, color, is_system) VALUES
('d0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'HUMAN', 'Myself', 'user', '#0ea5e9', false),
('d0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'HUMAN', 'Anxious Self', 'cloud-rain', '#64748b', false),
('d0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'HUMAN', 'Strategic Mind', 'brain', '#8b5cf6', false);