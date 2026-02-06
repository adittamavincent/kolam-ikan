-- 06_canvases.sql

-- Canvas for 'Understanding Hooks'
INSERT INTO canvases (id, stream_id, content_json) VALUES
('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '[
  {
    "id": "block-1",
    "type": "heading",
    "props": { "level": 1, "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "React Hooks Cheatsheet", "styles": {} }],
    "children": []
  },
  {
    "id": "block-2",
    "type": "paragraph",
    "props": { "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Summary of core hooks and when to use them.", "styles": {} }],
    "children": []
  }
]'::jsonb);

-- Canvas for 'Editing Workflow'
INSERT INTO canvases (id, stream_id, content_json) VALUES
('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', '[
  {
    "id": "block-3",
    "type": "heading",
    "props": { "level": 1, "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Editing SOP v2", "styles": {} }],
    "children": []
  },
  {
    "id": "block-4",
    "type": "checkListItem",
    "props": { "textColor": "default", "backgroundColor": "default", "textAlignment": "left" },
    "content": [{ "type": "text", "text": "Import footage and create proxies", "styles": {} }],
    "children": []
  }
]'::jsonb);