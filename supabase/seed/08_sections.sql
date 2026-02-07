-- 08_sections.sql

-- Section for Entry 1 (Hooks) - Authored by 'Myself'
INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order) VALUES
('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'Myself', '[
  {
    "id": "sect-1",
    "type": "paragraph",
    "props": { "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "useState vs useReducer exploration. useState is great for simple values, but Reducer feels better for complex objects.", "styles": {} }],
    "children": []
  }
]'::jsonb, 0);

-- Section for Entry 2 (Hooks) - Authored by 'The Architect' (System AI)
INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order) VALUES
('a0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'The Architect', '[
  {
    "id": "sect-2",
    "type": "paragraph",
    "props": { "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Consider the Custom Hook pattern here to abstract the logic away from the view layer.", "styles": {} }],
    "children": []
  }
]'::jsonb, 0);

-- Section for Entry 3 (Editing) - Authored by 'Anxious Self'
INSERT INTO sections (id, entry_id, persona_id, persona_name_snapshot, content_json, sort_order) VALUES
('a0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000007', 'Anxious Self', '[
  {
    "id": "sect-3",
    "type": "paragraph",
    "props": { "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Feedback from supervisor on pacing was tough to hear. Need to break down the timeline.", "styles": {} }],
    "children": []
  }
]'::jsonb, 0);